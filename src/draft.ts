import type { Issue } from '../shared/types.js';

export interface Draft { title: string; description: string; labels: string[]; status: string }
export const toDraft = (issue: Issue): Draft => ({ title: issue.title, description: issue.description,
  labels: issue.labels.map(label => label.id), status: issue.status?.id ?? '' });
export const sameDraft = (left: Draft, right: Draft) => left.title === right.title && left.description === right.description &&
  left.status === right.status && [...left.labels].sort().join('|') === [...right.labels].sort().join('|');

export function rebaseDraft(baseline: Issue, draft: Draft, current: Issue): Draft {
  const before = toDraft(baseline);
  const latest = toDraft(current);
  const additions = draft.labels.filter(id => !before.labels.includes(id));
  const removals = before.labels.filter(id => !draft.labels.includes(id));
  return {
    title: draft.title === before.title ? latest.title : draft.title,
    description: draft.description === before.description ? latest.description : draft.description,
    status: draft.status === before.status ? latest.status : draft.status,
    labels: [...new Set([...latest.labels.filter(id => !removals.includes(id)), ...additions])],
  };
}
