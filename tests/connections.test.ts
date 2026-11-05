import { describe, expect, it } from 'vitest';
import { GitLabService } from '../server/gitlab.js';
import type { GraphQLClient } from '../server/glab.js';
import type { ConnectionInput, ConnectionKind } from '../shared/types.js';
import { TEST_TARGET, connection, issue, labels, rawIssue, statuses } from './fixtures.js';

class ConnectionClient implements GraphQLClient {
  items = [rawIssue(issue(1)), rawIssue(issue(2))];
  writes: { query: string; input: Record<string, any> }[] = [];
  reject = false;
  ignoreDuplicate = false;
  async query<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
    if (query.includes('query Workspace')) return { project: { workItems: connection(this.items) } } as T;
    if (query.includes('query Issue')) return { project: { workItems: connection(this.items.filter(item => item.iid === variables.iid)) } } as T;
    if (query.includes('query Labels')) return { project: { labels: connection(labels) } } as T;
    if (query.includes('query Statuses')) return { namespace: { lifecycles: connection([{ statuses }]) } } as T;
    this.writes.push({ query, input: variables.input });
    if (query.includes('mutation AddConnection')) {
      if (!this.reject) {
        const [source, target] = this.items;
        const type = { RELATED: 'relates_to', BLOCKS: 'blocks', BLOCKED_BY: 'is_blocked_by' }[variables.input.linkType as 'RELATED'];
        source.widgets.push({ type: 'LINKED_ITEMS', linkedItems: connection([{ linkId: 'created', linkType: type, workItem: target }]) } as any);
      }
      return { workItemAddLinkedItems: { errors: this.reject ? ['Denied'] : [] } } as T;
    }
    if (query.includes('mutation MarkDuplicate')) {
      if (!this.reject && !this.ignoreDuplicate) {
        this.items[0].duplicatedToWorkItemUrl = this.items[1].webUrl.replace('/work_items/', '/issues/');
        this.items[0].state = 'CLOSED';
        this.items[0].widgets[0].status = statuses[6];
        this.items[0].widgets.push({ type: 'LINKED_ITEMS', linkedItems: connection([
          { linkId: 'duplicate-related', linkType: 'relates_to', workItem: this.items[1] },
        ]) } as any);
      }
      return { createNote: { errors: this.reject ? ['Denied'] : [] } } as T;
    }
    throw new Error('Unexpected query');
  }
}
const input = (kind: ConnectionKind = 'relates_to'): ConnectionInput => ({ targetIid: '2', kind,
  expectedSourceUpdatedAt: issue(1).updatedAt, expectedTargetUpdatedAt: issue(2).updatedAt });

describe('GitLab connections', () => {
  it.each([['relates_to', 'RELATED', '1', '2'], ['blocks', 'BLOCKS', '1', '2'],
    ['is_blocked_by', 'BLOCKED_BY', '2', '1']] as const)('creates and verifies %s with correct direction', async (kind, native, from, to) => {
    const client = new ConnectionClient();
    const result = await new GitLabService(client, TEST_TARGET).connect('1', input(kind));
    expect(client.writes[0].input).toEqual({ id: issue(1).id, workItemsIds: [issue(2).id], linkType: native });
    expect(result.relations[0]).toMatchObject({ source: issue(Number(from)).id, target: issue(Number(to)).id,
      kind: kind === 'relates_to' ? 'relates_to' : 'blocks' });
  });
  it('marks an explicitly confirmed duplicate and verifies its closed state and original', async () => {
    const client = new ConnectionClient();
    const result = await new GitLabService(client, TEST_TARGET).connect('1', { ...input('duplicate'), confirmDuplicate: true });
    expect(client.writes[0].input).toEqual({ noteableId: issue(1).id, body: '/duplicate #2' });
    expect(result.issues[0].state).toBe('CLOSED');
    expect(result.relations).toEqual([{ id: `duplicate:${issue(1).id}:${issue(2).id}`,
      source: issue(1).id, target: issue(2).id, kind: 'duplicate' }]);
    expect(result.references).toHaveLength(0);
  });
  it('does not run duplicate actions without explicit confirmation', async () => {
    const client = new ConnectionClient();
    await expect(new GitLabService(client, TEST_TARGET).connect('1', input('duplicate'))).rejects.toMatchObject({ statusCode: 400 });
    expect(client.writes).toHaveLength(0);
  });
  it('does not claim success if GitLab ignores the duplicate quick action', async () => {
    const client = new ConnectionClient(); client.ignoreDuplicate = true;
    await expect(new GitLabService(client, TEST_TARGET).connect('1', { ...input('duplicate'), confirmDuplicate: true }))
      .rejects.toMatchObject({ statusCode: 422 });
  });
  it('rejects self-links, missing tickets, stale versions and absent permissions before writing', async () => {
    const client = new ConnectionClient();
    const service = new GitLabService(client, TEST_TARGET);
    await expect(service.connect('1', { ...input(), targetIid: '1' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.connect('1', { ...input(), targetIid: '999' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.connect('1', { ...input(), expectedTargetUpdatedAt: 'old' })).rejects.toMatchObject({ statusCode: 409 });
    client.items[1].userPermissions.adminWorkItemLink = false;
    await expect(service.connect('1', input())).rejects.toMatchObject({ statusCode: 403 });
    expect(client.writes).toHaveLength(0);
  });
  it('rejects duplicate links and does not retry rejected mutations', async () => {
    const client = new ConnectionClient();
    const service = new GitLabService(client, TEST_TARGET);
    await service.connect('1', input());
    await expect(service.connect('1', input())).rejects.toMatchObject({ statusCode: 409 });
    expect(client.writes).toHaveLength(1);
    const denied = new ConnectionClient(); denied.reject = true;
    await expect(new GitLabService(denied, TEST_TARGET).connect('1', input())).rejects.toMatchObject({ statusCode: 422 });
    expect(denied.writes).toHaveLength(1);
  });
});
