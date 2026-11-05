import { describe, expect, it } from 'vitest';
import { rebaseDraft, toDraft } from '../src/draft.js';
import { issue, labels, statuses } from './fixtures.js';

describe('conflict reconciliation', () => {
  it('preserves concurrent description, status and label changes for a title-only draft', () => {
    const baseline = issue(1, { labels: [labels[0]] });
    const draft = { ...toDraft(baseline), title: 'My new title' };
    const current = issue(1, { title: 'Concurrent title', description: 'New description in GitLab',
      status: statuses[3], labels: [labels[1], labels[2]], updatedAt: '2026-11-04T13:00:00Z' });
    expect(rebaseDraft(baseline, draft, current)).toEqual({ title: 'My new title',
      description: current.description, status: statuses[3].id, labels: [labels[1].id, labels[2].id] });
  });
  it('reapplies label additions and removals without losing concurrent labels', () => {
    const baseline = issue(1, { labels: [labels[0], labels[1]] });
    const draft = { ...toDraft(baseline), labels: [labels[0].id, labels[2].id] };
    const current = issue(1, { labels: [labels[1], labels[3]] });
    expect(rebaseDraft(baseline, draft, current).labels).toEqual([labels[3].id, labels[2].id]);
  });
  it('keeps deliberate user text and status changes, including an empty description', () => {
    const baseline = issue(1);
    const draft = { ...toDraft(baseline), description: '', status: statuses[2].id };
    const current = issue(1, { title: 'New title from GitLab', description: 'Remote edit', status: statuses[1] });
    expect(rebaseDraft(baseline, draft, current)).toMatchObject({ title: current.title, description: '', status: statuses[2].id });
  });
});
