import { describe, expect, it } from 'vitest';
import type { GraphQLClient } from '../server/glab.js';
import { GitLabService } from '../server/gitlab.js';
import type { CreateConnectedInput, NewConnectionKind } from '../shared/types.js';
import { TEST_TARGET, connection, issue, labels, rawIssue, statuses } from './fixtures.js';

class CreationClient implements GraphQLClient {
  items = [rawIssue(issue(1))];
  writes: Record<string, any>[] = [];
  failAfterCreate = false;
  omitConnection = false;
  canCreate = true;
  async query<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
    if (query.includes('query Issue')) return { project: { workItems: connection(this.items.filter(item => item.iid === variables.iid)) } } as T;
    if (query.includes('query Workspace')) {
      if (this.failAfterCreate && this.writes.length) throw new Error('offline after mutation');
      return { project: { workItems: connection(this.items) } } as T;
    }
    if (query.includes('query Labels')) return { project: { labels: connection(labels) } } as T;
    if (query.includes('query Statuses')) return { namespace: { lifecycles: connection([{ statuses }]) } } as T;
    if (query.includes('query CreationTypes')) return { project: { workItemTypes: connection([
      { id: 'type:task', name: 'Task', enabled: true, canUserCreateItems: this.canCreate },
      { id: 'type:issue', name: 'Issue', enabled: true, canUserCreateItems: this.canCreate },
    ]) } } as T;
    if (query.includes('mutation CreateConnected')) {
      const input = variables.input; this.writes.push(input);
      const item = rawIssue(issue(9, { title: input.title, description: input.descriptionWidget.description,
        typeName: input.workItemTypeId === 'type:task' ? 'Task' : 'Issue' }));
      const reference = { id: issue(1).id, iid: '1', title: issue(1).title, webUrl: issue(1).webUrl };
      if (!this.omitConnection) {
        if (input.hierarchyWidget) (item.widgets[4] as any).parent = reference;
        else if (input.linkedItemsWidget) item.widgets.push({ type: 'LINKED_ITEMS', linkedItems: connection([{ linkId: 'new-link',
          linkType: { RELATED: 'relates_to', BLOCKED_BY: 'is_blocked_by', BLOCKS: 'blocks' }[input.linkedItemsWidget.linkType as 'RELATED'],
          workItem: reference }]) } as any);
      }
      this.items.push(item);
      return { workItemCreate: { errors: [], workItem: { id: item.id, iid: item.iid } } } as T;
    }
    throw new Error('Unexpected query');
  }
}
const input = (kind: NewConnectionKind = 'subtask'): CreateConnectedInput => ({
  operationId: '11111111-1111-4111-8111-111111111111', expectedSourceUpdatedAt: issue(1).updatedAt,
  title: 'Neue Karte', description: 'Details', labelIds: [labels[0].id], kind,
});

describe('connected ticket creation', () => {
  it('defaults to a native Task created with its parent in one mutation', async () => {
    const client = new CreationClient();
    const service = new GitLabService(client, TEST_TARGET);
    expect((await service.creationOptions('1')).canCreateSubtask).toBe(true);
    const result = await service.createConnected('1', input());
    expect(result.createdIid).toBe('9');
    expect(client.writes[0]).toMatchObject({ namespacePath: TEST_TARGET.project, workItemTypeId: 'type:task',
      hierarchyWidget: { parentId: issue(1).id }, labelsWidget: { labelIds: [labels[0].id] } });
    expect(result.workspace.relations[0]).toMatchObject({ kind: 'parent', source: issue(1).id, target: issue(9).id });
  });
  it.each([['relates_to', 'RELATED'], ['blocks', 'BLOCKED_BY'], ['is_blocked_by', 'BLOCKS']] as const)
    ('creates %s with the correct new-to-existing GitLab direction', async (kind, linkType) => {
      const client = new CreationClient();
      const result = await new GitLabService(client, TEST_TARGET).createConnected('1', input(kind));
      expect(client.writes[0]).toMatchObject({ workItemTypeId: 'type:issue',
        linkedItemsWidget: { linkType, workItemsIds: [issue(1).id] } });
      expect(result.createdIid).toBe('9');
    });
  it('replays the same operation without creating a second ticket and rejects changed input', async () => {
    const client = new CreationClient(); const service = new GitLabService(client, TEST_TARGET);
    const [first, second] = await Promise.all([service.createConnected('1', input()), service.createConnected('1', input())]);
    expect(first.createdIid).toBe(second.createdIid); expect(client.writes).toHaveLength(1);
    await expect(service.createConnected('1', { ...input(), title: 'different' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('does not retry an uncertain creation when reading the result fails', async () => {
    const client = new CreationClient(); client.failAfterCreate = true;
    const service = new GitLabService(client, TEST_TARGET);
    await expect(service.createConnected('1', input())).rejects.toMatchObject({ statusCode: 502 });
    await expect(service.createConnected('1', input())).rejects.toMatchObject({ statusCode: 502 });
    expect(client.writes).toHaveLength(1);
  });
  it('reports the created ticket number if the relationship cannot be verified', async () => {
    const client = new CreationClient(); client.omitConnection = true;
    await expect(new GitLabService(client, TEST_TARGET).createConnected('1', input())).rejects.toThrow('Ticket #9 wurde angelegt');
    expect(client.writes).toHaveLength(1);
  });
  it('rejects stale source, foreign labels and unavailable creation rights before mutation', async () => {
    const stale = new CreationClient();
    await expect(new GitLabService(stale, TEST_TARGET).createConnected('1', { ...input(), expectedSourceUpdatedAt: 'old' })).rejects.toMatchObject({ statusCode: 409 });
    expect(stale.writes).toHaveLength(0);
    const foreign = new CreationClient();
    await expect(new GitLabService(foreign, TEST_TARGET).createConnected('1', { ...input(), labelIds: ['foreign'] })).rejects.toMatchObject({ statusCode: 400 });
    expect(foreign.writes).toHaveLength(0);
    const denied = new CreationClient(); denied.canCreate = false;
    await expect(new GitLabService(denied, TEST_TARGET).createConnected('1', input())).rejects.toMatchObject({ statusCode: 403 });
    expect(denied.writes).toHaveLength(0);
  });
  it('does not allow a nested Task under another Task', async () => {
    const client = new CreationClient(); client.items[0].workItemType.name = 'Task';
    const service = new GitLabService(client, TEST_TARGET);
    expect((await service.creationOptions('1')).canCreateSubtask).toBe(false);
    await expect(service.createConnected('1', input())).rejects.toMatchObject({ statusCode: 403 });
    expect(client.writes).toHaveLength(0);
  });
});


describe('independent ticket creation', () => {
  const independent = () => ({ operationId: input().operationId, title: 'Independent issue',
    description: 'Details', labelIds: [labels[0].id] });
  it('writes the injected subgroup namespace without a caller-selected project', async () => {
    const client = new CreationClient();
    const target = { gitlabUrl: 'https://selfhosted.example.com:8443', project: 'group/subgroup/project' };
    const result = await new GitLabService(client, target).createIssue(independent());
    expect(client.writes[0].namespacePath).toBe(target.project);
    expect(result.workspace.gitlabUrl).toBe(target.gitlabUrl);
    expect(result.workspace.project).toBe(target.project);
  });
  it('creates an Issue without a source or relationship and shares the replay guard', async () => {
    const client = new CreationClient(); client.items = [];
    const service = new GitLabService(client, TEST_TARGET);
    const options = await service.creationOptions();
    expect(options.canCreateIssue).toBe(true);
    expect(options.source).toBeUndefined();
    const [first, replay] = await Promise.all([service.createIssue(independent()), service.createIssue(independent())]);
    expect(first.createdIid).toBe('9');
    expect(replay.createdIid).toBe('9');
    expect(client.writes).toHaveLength(1);
    expect(client.writes[0]).toMatchObject({ namespacePath: TEST_TARGET.project, workItemTypeId: 'type:issue',
      title: 'Independent issue', descriptionWidget: { description: 'Details' }, labelsWidget: { labelIds: [labels[0].id] } });
    expect(client.writes[0]).not.toHaveProperty('hierarchyWidget');
    expect(client.writes[0]).not.toHaveProperty('linkedItemsWidget');
    expect(first.workspace.relations).toHaveLength(0);
    await expect(service.createIssue({ ...independent(), title: 'changed' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.createConnected('1', input())).rejects.toMatchObject({ statusCode: 409 });
  });
  it('checks project labels and creation permissions before writing', async () => {
    const client = new CreationClient(); client.canCreate = false;
    const service = new GitLabService(client, TEST_TARGET);
    expect((await service.creationOptions()).canCreateIssue).toBe(false);
    await expect(service.createIssue(independent())).rejects.toMatchObject({ statusCode: 403 });
    expect(client.writes).toHaveLength(0);
    const foreign = new CreationClient();
    await expect(new GitLabService(foreign, TEST_TARGET).createIssue({ ...independent(), labelIds: ['foreign'] }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(foreign.writes).toHaveLength(0);
  });
  it('retains an uncertain write result without retrying the mutation', async () => {
    const client = new CreationClient(); client.failAfterCreate = true;
    const service = new GitLabService(client, TEST_TARGET);
    await expect(service.createIssue(independent())).rejects.toMatchObject({ statusCode: 502 });
    await expect(service.createIssue(independent())).rejects.toMatchObject({ statusCode: 502 });
    expect(client.writes).toHaveLength(1);
  });
});
