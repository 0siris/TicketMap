import type { GitLabTarget, Issue, Label, Status, Workspace } from '../shared/types.js';

export const TEST_TARGET: GitLabTarget = { gitlabUrl: 'https://gitlab.example.com', project: 'example/team-project' };
export const PROJECT_PATH = TEST_TARGET.project;

export const statuses: Status[] = [
  ['Open', '#808080', 'triage'], ['To do', '#eee600', 'to_do'], ['Doing', '#009966', 'in_progress'],
  ['Review', '#9400d3', 'in_progress'], ['Closed', '#36454f', 'done'],
  ["Won't do", '#dd2b0e', 'canceled'], ['Duplicate', '#dd2b0e', 'canceled'],
].map(([name, color, category], index) => ({ id: `gid://gitlab/Status/${index + 1}`, name, color, category }));
export const labels: Label[] = [{ id: 'label:viewer', name: 'Treatment Viewer', color: '#84993e' },
  { id: 'label:ai', name: 'AI', color: '#9400d3' }, { id: 'label:bug', name: 'Bug', color: '#6699cc' },
  { id: 'label:legacy', name: 'state::Doing', color: '#5cb85c' }];
export function issue(number: number, extra: Partial<Issue> = {}): Issue {
  return { id: `gid://gitlab/WorkItem/${number}`, iid: String(number), title: `Ticket ${number}`,
    description: `Beschreibung für Ticket ${number}`, state: 'OPEN', updatedAt: '2026-11-04T12:00:00Z',
    webUrl: `${TEST_TARGET.gitlabUrl}/${PROJECT_PATH}/-/work_items/${number}`, status: statuses[0],
    labels: [], assignees: [], milestone: null, canEdit: true, canSetMetadata: true,
    canLink: true, canDuplicate: true, duplicateOf: null, typeName: 'Issue', canAddChild: true, ...extra };
}
export function fixture(): Workspace {
  const issues = [
    issue(1, { title: 'Treatment Viewer', labels: [labels[0]],
      description: '# Viewer\n\nEin **sicherer** Markdown-Text.\n\n- Modell anzeigen\n- Navigation prüfen\n\n<script>window.unsafe=true</script>\n\n![Privat](https://example.invalid/tracker.png)',
      assignees: [{ id: 'person:1', name: 'Alex Example', username: 'alex' }] }),
    issue(2, { title: 'Modell drehen', status: statuses[2], labels: [labels[0], labels[2]],
      milestone: { id: 'milestone:1', title: 'Viewer v1' } }),
    issue(3, { title: 'KI Klassifizierung', status: statuses[3], labels: [labels[1]] }),
    issue(4, { title: 'Ohne Verbindungen', labels: [labels[3]] }),
    issue(5, { title: 'Abgeschlossen', status: statuses[4], state: 'CLOSED' }),
    issue(6, { title: 'Doppelt', status: statuses[6], state: 'CLOSED' }),
    issue(7, { title: 'Nicht geplant', status: statuses[5], state: 'CLOSED' }),
    issue(8, { title: 'Bald starten', status: statuses[1] }),
  ];
  return { ...TEST_TARGET, fetchedAt: '2026-11-04T12:00:00Z', issues, labels: structuredClone(labels),
    statuses: structuredClone(statuses), references: [], relations: [
      { id: 'parent:1:2', source: issues[0].id, target: issues[1].id, kind: 'parent' },
      { id: 'blocks:3:2', source: issues[2].id, target: issues[1].id, kind: 'blocks' },
      { id: 'relates:1:3', source: issues[0].id, target: issues[2].id, kind: 'relates_to' },
    ] };
}

export const connection = <T>(nodes: T[], cursor: string | null = null) => ({ nodes,
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor } });
export function rawIssue(item: Issue) {
  return { ...item, project: { fullPath: PROJECT_PATH },
    duplicatedToWorkItemUrl: item.duplicateOf, workItemType: { name: item.typeName },
    userPermissions: { updateWorkItem: item.canEdit, setWorkItemMetadata: item.canSetMetadata,
      adminWorkItemLink: item.canLink, createNote: item.canDuplicate, adminParentLink: item.canAddChild }, widgets: [
      { type: 'STATUS', status: item.status },
      { type: 'LABELS', labels: connection(item.labels.map(label => ({ ...label, title: label.name }))) },
      { type: 'ASSIGNEES', assignees: connection(item.assignees) },
      { type: 'MILESTONE', milestone: item.milestone },
      { type: 'HIERARCHY', parent: null, children: connection([]) },
      { type: 'LINKED_ITEMS', linkedItems: connection([]) },
    ] };
}
