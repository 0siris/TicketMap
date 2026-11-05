import type { Filters, Issue, Relation, ViewState, Workspace } from './types.js';

export const emptyFilters = (): Filters => ({ query: '', statuses: [], labels: [], assignees: [],
  milestones: [], relations: [], context: false });

export function readView(search: string): ViewState {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  return {
    view: view === 'themes' || view === 'hierarchy' ? view : 'network',
    selected: /^\d+$/.test(params.get('issue') ?? '') ? params.get('issue')! : '',
    theme: params.get('theme') ?? '', collapsed: params.getAll('collapsed'),
    overview: params.get('overview') === '1',
    filters: { query: params.get('q') ?? '', statuses: params.getAll('status'), labels: params.getAll('label'),
      assignees: params.getAll('assignee'), milestones: params.getAll('milestone'),
      relations: params.getAll('relation').filter((value): value is Relation['kind'] =>
        ['parent', 'blocks', 'relates_to', 'duplicate'].includes(value)), context: params.get('context') === '1' },
  };
}

export function writeView(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.view !== 'network') params.set('view', state.view);
  if (state.selected) params.set('issue', state.selected);
  if (state.theme) params.set('theme', state.theme);
  if (state.overview) params.set('overview', '1');
  if (state.filters.query) params.set('q', state.filters.query);
  if (state.filters.context) params.set('context', '1');
  for (const [key, values] of Object.entries({ status: state.filters.statuses, label: state.filters.labels,
    assignee: state.filters.assignees, milestone: state.filters.milestones, relation: state.filters.relations,
    collapsed: state.collapsed })) for (const value of values) params.append(key, value);
  return params.toString() ? `?${params}` : '';
}

export function filterIssues(workspace: Workspace, filters: Filters): Issue[] {
  const query = filters.query.trim().toLocaleLowerCase('de');
  const linked = new Set(workspace.relations.filter(edge => filters.relations.includes(edge.kind))
    .flatMap(edge => [edge.source, edge.target]));
  return workspace.issues.filter(issue =>
    (!query || `#${issue.iid} ${issue.title} ${issue.description}`.toLocaleLowerCase('de').includes(query)) &&
    (!filters.statuses.length || filters.statuses.includes(issue.status?.id ?? 'none')) &&
    (!filters.labels.length || issue.labels.some(label => filters.labels.includes(label.id))) &&
    (!filters.assignees.length || issue.assignees.some(person => filters.assignees.includes(person.id)) ||
      (!issue.assignees.length && filters.assignees.includes('none'))) &&
    (!filters.milestones.length || filters.milestones.includes(issue.milestone?.id ?? 'none')) &&
    (!filters.relations.length || linked.has(issue.id)));
}

export function visibleGraph(workspace: Workspace, matched: Issue[], state: ViewState) {
  const matches = matched.filter(issue => state.view !== 'themes' || !state.theme ||
    issue.labels.some(label => label.id === state.theme));
  const matchIds = new Set(matches.map(issue => issue.id));
  const visibleIds = new Set(matchIds);
  const allowedEdges = workspace.relations.filter(edge =>
    (!state.filters.relations.length || state.filters.relations.includes(edge.kind)) &&
    (state.view !== 'hierarchy' || edge.kind === 'parent'));
  const referenceIds = new Set(workspace.references.map(reference => reference.id));
  for (const edge of allowedEdges) {
    if (matchIds.has(edge.source) && referenceIds.has(edge.target)) visibleIds.add(edge.target);
    if (matchIds.has(edge.target) && referenceIds.has(edge.source)) visibleIds.add(edge.source);
  }
  if (state.filters.context) for (const edge of allowedEdges) {
    if (matchIds.has(edge.source)) visibleIds.add(edge.target);
    if (matchIds.has(edge.target)) visibleIds.add(edge.source);
  }
  const hidden = new Set<string>();
  if (state.view === 'hierarchy') {
    const children = new Map<string, string[]>();
    for (const edge of workspace.relations.filter(edge => edge.kind === 'parent'))
      children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
    const visit = (id: string, ancestors: Set<string>) => {
      if (ancestors.has(id)) return;
      const next = new Set([...ancestors, id]);
      for (const child of children.get(id) ?? []) {
        hidden.add(child); visit(child, next);
      }
    };
    for (const id of state.collapsed) if (visibleIds.has(id)) visit(id, new Set());
    for (const id of hidden) visibleIds.delete(id);
  }
  return {
    matches,
    nodes: workspace.issues.filter(issue => visibleIds.has(issue.id)),
    references: workspace.references.filter(reference => visibleIds.has(reference.id)),
    relations: allowedEdges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    matchIds,
  };
}
