import { describe, expect, it } from 'vitest';
import { collectPages, GitLabService, normalizeIssue, normalizeRelations } from '../server/gitlab.js';
import type { GraphQLClient } from '../server/glab.js';
import type { Issue } from '../shared/types.js';
import { TEST_TARGET, connection, fixture, issue, labels, rawIssue, statuses } from './fixtures.js';

class MockClient implements GraphQLClient {
  items = [rawIssue(issue(1, { labels: [labels[0]] }))];
  writes: Record<string, any>[] = [];
  calls: { query: string; variables: Record<string, any> }[] = [];
  mutationErrors: string[] = [];
  async query<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
    this.calls.push({ query, variables });
    let result: unknown;
    if (query.includes('query Workspace')) result = { project: { workItems: connection(this.items) } };
    else if (query.includes('query Issue')) result = { project: { workItems: connection(this.items.filter(item => item.iid === variables.iid)) } };
    else if (query.includes('query Labels')) result = { project: { labels: connection(labels) } };
    else if (query.includes('query Statuses')) result = { namespace: { lifecycles: connection([{ statuses }]) } };
    else if (query.includes('mutation UpdateIssue')) {
      this.writes.push(variables.input);
      const target = this.items.find(item => item.id === variables.input.id)!;
      if (!this.mutationErrors.length) {
        if (variables.input.title) target.title = variables.input.title;
        if (variables.input.descriptionWidget) target.description = variables.input.descriptionWidget.description;
        if (variables.input.statusWidget) target.widgets[0].status = statuses.find(status => status.id === variables.input.statusWidget.status);
        target.updatedAt = '2026-11-04T13:00:00Z';
      }
      result = { workItemUpdate: { errors: this.mutationErrors, workItem: { id: target.id } } };
    } else throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
    return result as T;
  }
}

describe('GitLab normalization and pagination', () => {
  it('uses the injected subgroup project for every workspace query and reports its origin', async () => {
    const client = new MockClient();
    const target = { gitlabUrl: 'https://selfhosted.example.com:8443', project: 'another/subgroup/project' };
    const workspace = await new GitLabService(client, target).workspace();
    expect(workspace.gitlabUrl).toBe(target.gitlabUrl);
    expect(workspace.project).toBe(target.project);
    expect(client.calls.every(call => call.variables.path === target.project)).toBe(true);
  });
  it('resolves duplicate URLs only against the configured origin and subgroup path', () => {
    const target = { gitlabUrl: 'https://selfhosted.example.com:8443', project: 'another/subgroup/project' };
    const first = rawIssue(issue(1));
    const second = rawIssue(issue(2));
    first.webUrl = `${target.gitlabUrl}/${target.project}/-/work_items/1`;
    second.webUrl = `${target.gitlabUrl}/${target.project}/-/work_items/2`;
    first.duplicatedToWorkItemUrl = `/${target.project}/-/issues/2`;
    const normalized = normalizeRelations([first, second], target);
    expect(normalized.relations).toEqual([{ id: `duplicate:${first.id}:${second.id}`,
      source: first.id, target: second.id, kind: 'duplicate' }]);
    first.duplicatedToWorkItemUrl = `https://other.example.com/${target.project}/-/issues/2`;
    expect(normalizeRelations([first, second], target).relations).toEqual([]);
  });
  it('loads all pages and detects repeated cursors', async () => {
    expect(await collectPages(async cursor => cursor ? connection([2]) : connection([1], 'next'))).toEqual([1, 2]);
    await expect(collectPages(async () => connection([], 'same'))).rejects.toThrow('Seitenfolge');
  });
  it('preserves every native status without using state labels', () => {
    for (const status of statuses) {
      const normalized = normalizeIssue(rawIssue(issue(1, { status, labels: [labels[3]] })));
      expect(normalized.status).toEqual(status);
      expect(normalized.labels[0].name).toBe('state::Doing');
    }
  });
  it('deduplicates links from both ends and directs blockers to blocked tickets', () => {
    const first = rawIssue(issue(1));
    const second = rawIssue(issue(2));
    first.widgets.push({ type: 'LINKED_ITEMS', linkedItems: connection([
      { linkId: 'link', linkType: 'is_blocked_by', workItem: second },
    ]) } as any);
    second.widgets.push({ type: 'LINKED_ITEMS', linkedItems: connection([
      { linkId: 'link', linkType: 'blocks', workItem: first },
    ]) } as any);
    first.widgets.push({ type: 'HIERARCHY', children: connection([second]), parent: null } as any);
    second.widgets.push({ type: 'HIERARCHY', children: connection([]), parent: first } as any);
    const normalized = normalizeRelations([first, second], TEST_TARGET);
    expect(normalized.relations).toHaveLength(2);
    expect(normalized.relations.find(edge => edge.kind === 'blocks')).toMatchObject({ source: second.id, target: first.id });
    expect(normalized.references).toEqual([]);
  });
  it('keeps project-external references outside editable issues', () => {
    const item = rawIssue(issue(1));
    item.widgets.push({ type: 'LINKED_ITEMS', linkedItems: connection([
      { linkId: 'external', linkType: 'relates_to', workItem: rawIssue(issue(999)) },
    ]) } as any);
    expect(normalizeRelations([item], TEST_TARGET).references[0].iid).toBe('999');
  });
  it('continues nested connection pages', async () => {
    const client = new MockClient();
    client.items[0].widgets[1].labels = connection([labels[0]], 'label-next') as any;
    const original = client.query.bind(client);
    client.query = async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      if (query.includes('query ItemConnection')) {
        expect(variables?.after).toBe('label-next');
        return { node: { widgets: [{ type: 'LABELS', labels: connection([labels[1]]) }] } } as T;
      }
      return original(query, variables);
    };
    const workspace = await new GitLabService(client, TEST_TARGET).workspace();
    expect(workspace.issues[0].labels.map(label => label.name)).toEqual(['Treatment Viewer', 'AI']);
  });
});

describe('ticket updates', () => {
  it('sends only changed fields with label deltas and reloads the GitLab result', async () => {
    const client = new MockClient();
    const service = new GitLabService(client, TEST_TARGET);
    const updated = await service.update('1', { expectedUpdatedAt: issue(1).updatedAt, title: 'Neuer Titel',
      statusId: statuses[2].id, addLabelIds: [labels[1].id], removeLabelIds: [labels[0].id] });
    expect(updated.title).toBe('Neuer Titel');
    expect(updated.status?.name).toBe('Doing');
    expect(client.writes[0]).toEqual({ id: issue(1).id, title: 'Neuer Titel',
      statusWidget: { status: statuses[2].id }, labelsWidget: { addLabelIds: [labels[1].id], removeLabelIds: [labels[0].id] } });
    expect(client.calls.filter(call => call.query.includes('query Issue'))).toHaveLength(2);
  });
  it('rejects stale versions before any mutation', async () => {
    const client = new MockClient();
    await expect(new GitLabService(client, TEST_TARGET).update('1', { expectedUpdatedAt: 'old', title: 'Overwrite' }))
      .rejects.toMatchObject({ statusCode: 409, current: { title: 'Ticket 1' } });
    expect(client.writes).toHaveLength(0);
  });
  it('checks edit and metadata permissions separately', async () => {
    const client = new MockClient();
    client.items[0].userPermissions = { updateWorkItem: false, setWorkItemMetadata: false, adminWorkItemLink: false, createNote: false, adminParentLink: false };
    const service = new GitLabService(client, TEST_TARGET);
    await expect(service.update('1', { expectedUpdatedAt: issue(1).updatedAt, title: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update('1', { expectedUpdatedAt: issue(1).updatedAt, statusId: statuses[1].id })).rejects.toMatchObject({ statusCode: 403 });
    expect(client.writes).toHaveLength(0);
  });
  it('rejects unknown labels and statuses without mutation', async () => {
    const client = new MockClient();
    const service = new GitLabService(client, TEST_TARGET);
    await expect(service.update('1', { expectedUpdatedAt: issue(1).updatedAt, addLabelIds: ['foreign'] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.update('1', { expectedUpdatedAt: issue(1).updatedAt, statusId: 'foreign' })).rejects.toMatchObject({ statusCode: 400 });
    expect(client.writes).toHaveLength(0);
  });
  it('does not mutate for an unchanged draft and reports GitLab mutation errors', async () => {
    const client = new MockClient();
    const service = new GitLabService(client, TEST_TARGET);
    await service.update('1', { expectedUpdatedAt: issue(1).updatedAt, title: 'Ticket 1' });
    expect(client.writes).toHaveLength(0);
    client.mutationErrors = ['not allowed'];
    await expect(service.update('1', { expectedUpdatedAt: issue(1).updatedAt, title: 'new' })).rejects.toMatchObject({ statusCode: 422 });
  });
  it('does not accept a work item from another project', async () => {
    const client = new MockClient();
    client.items[0].project = { fullPath: 'other/project' };
    await expect(new GitLabService(client, TEST_TARGET).issue('1')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('does not replace the cached workspace after a failed refresh', async () => {
    const client = new MockClient();
    const service = new GitLabService(client, TEST_TARGET);
    const first = await service.workspace();
    client.query = async () => { throw new Error('offline'); };
    await expect(service.workspace(true)).rejects.toThrow('offline');
    expect(await service.workspace()).toBe(first);
  });
  it('does not cache an older in-flight snapshot after invalidation', async () => {
    const client = new MockClient();
    const original = client.query.bind(client);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    client.query = async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      if (query.includes('query Workspace') && first) {
        first = false;
        const result = structuredClone(await original(query, variables));
        await gate;
        return result as T;
      }
      return original(query, variables);
    };
    const service = new GitLabService(client, TEST_TARGET);
    const pending = service.workspace();
    service.invalidate();
    client.items[0].title = 'New version';
    release();
    expect((await pending).issues[0].title).toBe('New version');
    expect((await service.workspace()).issues[0].title).toBe('New version');
  });
});
