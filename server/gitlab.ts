import { type GitLabTarget, type Issue, type IssuePatch, type Label, type Reference,
  type Relation, type Status, type Workspace, type ConnectionInput, type CreateConnectedInput, type CreateIssueInput,
  type CreatedConnection, type CreationOptions } from '../shared/types.js';
import { type GraphQLClient, ServiceError } from './glab.js';

interface Connection<T> { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
interface RawReference extends Reference { project?: { fullPath: string } | null }
interface Link { linkId: string; linkType: string; workItem: RawReference }
interface Widget {
  type: string;
  status?: Status | null;
  labels?: Connection<Label>;
  assignees?: Connection<Issue['assignees'][number]>;
  milestone?: Issue['milestone'];
  parent?: RawReference | null;
  children?: Connection<RawReference>;
  linkedItems?: Connection<Link>;
}
interface RawIssue extends Omit<Issue, 'labels' | 'assignees' | 'milestone' | 'status' | 'canEdit' | 'canSetMetadata' | 'canLink' | 'canDuplicate' | 'duplicateOf' | 'typeName' | 'canAddChild'> {
  project: { fullPath: string } | null;
  userPermissions: { updateWorkItem: boolean; setWorkItemMetadata: boolean; adminWorkItemLink?: boolean; createNote?: boolean; adminParentLink?: boolean };
  workItemType?: { name: string };
  duplicatedToWorkItemUrl?: string | null;
  widgets: Widget[];
}

const PAGE = 'pageInfo { hasNextPage endCursor }';
const REFERENCE = 'id iid title webUrl project { fullPath }';
const STATUS = 'id name color category';
const ITEM = `id iid title description state updatedAt webUrl duplicatedToWorkItemUrl workItemType { name } project { fullPath }
  userPermissions { updateWorkItem setWorkItemMetadata adminWorkItemLink createNote adminParentLink }
  widgets { type
    ... on WorkItemWidgetStatus { status { ${STATUS} } }
    ... on WorkItemWidgetLabels { labels(first: 100) { nodes { id title color } ${PAGE} } }
    ... on WorkItemWidgetAssignees { assignees(first: 100) { nodes { id name username } ${PAGE} } }
    ... on WorkItemWidgetMilestone { milestone { id title } }
    ... on WorkItemWidgetHierarchy { parent { ${REFERENCE} }
      children(first: 100) { nodes { ${REFERENCE} } ${PAGE} } }
    ... on WorkItemWidgetLinkedItems { linkedItems(first: 100) {
      nodes { linkId linkType workItem { ${REFERENCE} } } ${PAGE} } }
  }`;

export async function collectPages<T>(load: (cursor: string | null) => Promise<Connection<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await load(cursor);
    items.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return items;
    cursor = page.pageInfo.endCursor;
    if (!cursor || seen.has(cursor)) throw new ServiceError(502, 'GitLab lieferte eine unvollständige Seitenfolge.');
    seen.add(cursor);
  } while (true);
}

function normalizeLabel(label: Label & { title?: string }): Label {
  return { id: label.id, name: label.title ?? label.name, color: label.color };
}

export function normalizeIssue(raw: RawIssue): Issue {
  return {
    id: raw.id, iid: raw.iid, title: raw.title, description: raw.description ?? '', state: raw.state,
    updatedAt: raw.updatedAt, webUrl: raw.webUrl,
    status: raw.widgets.find(widget => widget.type === 'STATUS')?.status ?? null,
    labels: (raw.widgets.find(widget => widget.type === 'LABELS')?.labels?.nodes ?? []).map(normalizeLabel),
    assignees: raw.widgets.find(widget => widget.type === 'ASSIGNEES')?.assignees?.nodes ?? [],
    milestone: raw.widgets.find(widget => widget.type === 'MILESTONE')?.milestone ?? null,
    canEdit: raw.userPermissions.updateWorkItem,
    canSetMetadata: raw.userPermissions.setWorkItemMetadata,
    canLink: raw.userPermissions.adminWorkItemLink === true,
    canDuplicate: raw.userPermissions.updateWorkItem && raw.userPermissions.createNote === true,
    duplicateOf: raw.duplicatedToWorkItemUrl ?? null,
    typeName: raw.workItemType?.name ?? 'Issue',
    canAddChild: raw.workItemType?.name === 'Issue' && raw.userPermissions.adminParentLink === true,
  };
}

export function normalizeRelations(rawItems: RawIssue[], target: GitLabTarget): { relations: Relation[]; references: Reference[] } {
  const relations = new Map<string, Relation>();
  const references = new Map<string, Reference>();
  const ownIds = new Set(rawItems.map(item => item.id));
  function remember(item: RawReference) {
    if (!ownIds.has(item.id)) references.set(item.id, {
      id: item.id, iid: item.iid, title: item.title, webUrl: item.webUrl,
    });
  }
  function parentRelation(parent: RawReference, child: RawReference) {
    remember(parent); remember(child);
    const id = `parent:${parent.id}:${child.id}`;
    relations.set(id, { id, source: parent.id, target: child.id, kind: 'parent' });
  }
  for (const item of rawItems) for (const widget of item.widgets) {
    if (widget.parent) parentRelation(widget.parent, item);
    for (const child of widget.children?.nodes ?? []) parentRelation(item, child);
    for (const link of widget.linkedItems?.nodes ?? []) {
      remember(link.workItem);
      const blockedBy = link.linkType === 'is_blocked_by';
      if (!['relates_to', 'blocks', 'is_blocked_by'].includes(link.linkType))
        throw new ServiceError(502, 'GitLab lieferte einen unbekannten Beziehungstyp.');
      relations.set(link.linkId, {
        id: link.linkId, source: blockedBy ? link.workItem.id : item.id,
        target: blockedBy ? item.id : link.workItem.id,
        kind: link.linkType === 'relates_to' ? 'relates_to' : 'blocks',
      });
    }
  }
  for (const item of rawItems) {
    if (!item.duplicatedToWorkItemUrl) continue;
    let targetUrl: URL;
    try { targetUrl = new URL(item.duplicatedToWorkItemUrl, target.gitlabUrl); }
    catch { continue; }
    if (targetUrl.origin !== target.gitlabUrl || targetUrl.username || targetUrl.password) continue;
    const localPath = `/${target.project}/-/`;
    const localIid = targetUrl.pathname.startsWith(localPath)
      ? /^(?:issues|work_items)\/([1-9][0-9]*)\/?$/.exec(targetUrl.pathname.slice(localPath.length))?.[1] : undefined;
    const original = rawItems.find(value => value.webUrl === targetUrl.href || (localIid && value.iid === localIid));
    const targetId = original?.id ?? `reference:${targetUrl.href}`;
    if (!original) references.set(targetId, { id: targetId, iid: targetUrl.pathname.split('/').pop() ?? '',
      title: 'Original des Duplikats', webUrl: targetUrl.href });
    for (const [id, edge] of relations) if (edge.kind === 'relates_to' &&
      ((edge.source === item.id && edge.target === targetId) || (edge.target === item.id && edge.source === targetId)))
      relations.delete(id);
    const id = `duplicate:${item.id}:${targetId}`;
    relations.set(id, { id, source: item.id, target: targetId, kind: 'duplicate' });
  }
  return { relations: [...relations.values()], references: [...references.values()] };
}

export class GitLabService {
  private creations = new Map<string, { fingerprint: string; expires: number; result: Promise<CreatedConnection> }>();
  private cached?: Workspace;
  private pending?: { generation: number; promise: Promise<Workspace> };
  private generation = 0;
  constructor(private client: GraphQLClient, private readonly target: GitLabTarget) {}

  invalidate() { this.cached = undefined; this.generation++; }

  async workspace(refresh = false): Promise<Workspace> {
    if (!refresh && this.cached && Date.now() - Date.parse(this.cached.fetchedAt) < 30_000) return this.cached;
    if (this.pending?.generation === this.generation) return this.pending.promise;
    const generation = this.generation;
    const pending = { generation, promise: this.loadWorkspace().then(async snapshot => {
      if (generation !== this.generation) return this.workspace(true);
      this.cached = snapshot;
      return snapshot;
    }) };
    this.pending = pending;
    try { return await pending.promise; }
    finally { if (this.pending === pending) this.pending = undefined; }
  }

  private async completeItem(item: RawIssue): Promise<RawIssue> {
    const connections = [
      ['LABELS', 'labels', 'WorkItemWidgetLabels', 'id title color'],
      ['ASSIGNEES', 'assignees', 'WorkItemWidgetAssignees', 'id name username'],
      ['HIERARCHY', 'children', 'WorkItemWidgetHierarchy', REFERENCE],
      ['LINKED_ITEMS', 'linkedItems', 'WorkItemWidgetLinkedItems', `linkId linkType workItem { ${REFERENCE} }`],
    ] as const;
    for (const [widgetType, field, fragmentType, fields] of connections) {
      const widget = item.widgets.find(value => value.type === widgetType);
      const connection = widget?.[field] as Connection<unknown> | undefined;
      if (!connection?.pageInfo.hasNextPage) continue;
      const remaining = await collectPages<unknown>(async after => {
        const result = await this.client.query<{ node: { widgets: Widget[] } }>(`query ItemConnection($id: ID!, $after: String) {
          node(id: $id) { ... on WorkItem { widgets { type ... on ${fragmentType} {
            ${field}(first: 100, after: $after) { nodes { ${fields} } ${PAGE} }
          } } } } }`, { id: item.id, after: after ?? connection.pageInfo.endCursor });
        const next = result.node?.widgets.find(value => value.type === widgetType)?.[field];
        if (!next) throw new ServiceError(502, 'Eine GitLab-Verknüpfung konnte nicht vollständig geladen werden.');
        return next as Connection<unknown>;
      });
      connection.nodes.push(...remaining);
      connection.pageInfo.hasNextPage = false;
    }
    return item;
  }

  private async loadWorkspace(): Promise<Workspace> {
    const items = await collectPages<RawIssue>(async after => {
      const result = await this.client.query<{ project: { workItems: Connection<RawIssue> } | null }>(
        `query Workspace($path: ID!, $after: String) { project(fullPath: $path) {
          workItems(first: 100, after: $after) { nodes { ${ITEM} } ${PAGE} }
        } }`, { path: this.target.project, after });
      if (!result.project) throw new ServiceError(403, 'Kein Zugriff auf das konfigurierte GitLab-Projekt.');
      return result.project.workItems;
    });
    // Keep requests bounded when an item has more than one page of links or labels.
    for (const item of items) await this.completeItem(item);
    const labels = await collectPages<Label>(async after => {
      const result = await this.client.query<{ project: { labels: Connection<Label> } }>(
        `query Labels($path: ID!, $after: String) { project(fullPath: $path) {
          labels(first: 100, after: $after, includeAncestorGroups: true) { nodes { id title color } ${PAGE} }
        } }`, { path: this.target.project, after });
      return result.project.labels;
    });
    const lifecycles = await collectPages<{ statuses: Status[] }>(async after => {
      const result = await this.client.query<{ namespace: { lifecycles: Connection<{ statuses: Status[] }> } }>(
        `query Statuses($path: ID!, $after: String) { namespace(fullPath: $path) {
          lifecycles(first: 100, after: $after) { nodes { statuses { ${STATUS} } } ${PAGE} }
        } }`, { path: this.target.project, after });
      if (!result.namespace) throw new ServiceError(502, 'Der GitLab-Workflow konnte nicht geladen werden.');
      return result.namespace.lifecycles;
    });
    const statuses = new Map(lifecycles.flatMap(value => value.statuses).map(status => [status.id, status]));
    return { ...this.target, fetchedAt: new Date().toISOString(), issues: items.map(normalizeIssue),
      ...normalizeRelations(items, this.target), labels: labels.map(normalizeLabel), statuses: [...statuses.values()] };
  }

  async issue(iid: string): Promise<Issue> {
    const result = await this.client.query<{ project: { workItems: Connection<RawIssue> } | null }>(
      `query Issue($path: ID!, $iid: String!) { project(fullPath: $path) {
        workItems(iid: $iid, first: 1) { nodes { ${ITEM} } ${PAGE} }
      } }`, { path: this.target.project, iid });
    const item = result.project?.workItems.nodes[0];
    if (!item || item.project?.fullPath !== this.target.project)
      throw new ServiceError(404, 'Dieses Ticket ist in dem Projekt nicht verfügbar.');
    return normalizeIssue(await this.completeItem(item));
  }

  async update(iid: string, patch: IssuePatch): Promise<Issue> {
    const current = await this.issue(iid);
    if ((patch.title !== undefined || patch.description !== undefined) && !current.canEdit)
      throw new ServiceError(403, 'Du darfst dieses Ticket nicht bearbeiten.');
    if ((patch.statusId || patch.addLabelIds?.length || patch.removeLabelIds?.length) && !current.canSetMetadata)
      throw new ServiceError(403, 'Du darfst Status und Labels dieses Tickets nicht bearbeiten.');
    if (current.updatedAt !== patch.expectedUpdatedAt)
      throw new ServiceError(409, 'Das Ticket wurde inzwischen in GitLab geändert.', current);
    const metadata = await this.workspace();
    const knownLabels = new Set(metadata.labels.map(label => label.id));
    if ([...(patch.addLabelIds ?? []), ...(patch.removeLabelIds ?? [])].some(id => !knownLabels.has(id)) ||
      patch.addLabelIds?.some(id => patch.removeLabelIds?.includes(id)))
      throw new ServiceError(400, 'Die Labelauswahl ist ungültig. Bitte neu laden.');
    if (patch.statusId && !metadata.statuses.some(status => status.id === patch.statusId))
      throw new ServiceError(400, 'Dieser Status gehört nicht zum Projekt.');
    const input: Record<string, unknown> = { id: current.id };
    if (patch.title !== undefined && patch.title !== current.title) input.title = patch.title;
    if (patch.description !== undefined && patch.description !== current.description)
      input.descriptionWidget = { description: patch.description };
    const addLabelIds = (patch.addLabelIds ?? []).filter(id => !current.labels.some(label => label.id === id));
    const removeLabelIds = (patch.removeLabelIds ?? []).filter(id => current.labels.some(label => label.id === id));
    if (addLabelIds.length || removeLabelIds.length) input.labelsWidget = { addLabelIds, removeLabelIds };
    if (patch.statusId && patch.statusId !== current.status?.id) input.statusWidget = { status: patch.statusId };
    if (Object.keys(input).length === 1) return current;
    try {
      const result = await this.client.query<{ workItemUpdate: { errors: string[]; workItem: { id: string } | null } }>(
        `mutation UpdateIssue($input: WorkItemUpdateInput!) {
          workItemUpdate(input: $input) { errors workItem { id } }
        }`, { input });
      if (result.workItemUpdate.errors.length || !result.workItemUpdate.workItem)
        throw new ServiceError(422, 'GitLab hat die Änderung abgelehnt. Entwurf behalten und den aktuellen Stand prüfen.');
    } finally { this.invalidate(); }
    try { return await this.issue(iid); }
    catch { throw new ServiceError(502, 'Die Änderung wurde gesendet, aber nicht nachgeladen. Vor erneutem Speichern den GitLab-Stand prüfen.'); }
  }

  async connect(sourceIid: string, input: ConnectionInput): Promise<Workspace> {
    if (sourceIid === input.targetIid) throw new ServiceError(400, 'Ein Ticket kann nicht mit sich selbst verbunden werden.');
    const [source, target] = await Promise.all([this.issue(sourceIid), this.issue(input.targetIid)]);
    if (!source.canLink || !target.canLink) throw new ServiceError(403, 'Du darfst diese Tickets nicht miteinander verbinden.');
    if (source.updatedAt !== input.expectedSourceUpdatedAt || target.updatedAt !== input.expectedTargetUpdatedAt)
      throw new ServiceError(409, 'Eines der Tickets wurde geändert. Beide Tickets neu laden und die Verbindung prüfen.');
    if (input.kind === 'duplicate') {
      if (input.confirmDuplicate !== true) throw new ServiceError(400, 'Das Schließen als Duplikat muss ausdrücklich bestätigt werden.');
      if (!source.canDuplicate) throw new ServiceError(403, 'Du darfst dieses Ticket nicht als Duplikat schließen.');
      if (source.duplicateOf || source.state.toLowerCase() === 'closed')
        throw new ServiceError(409, 'Das Ausgangsticket ist bereits geschlossen oder als Duplikat markiert.');
    }
    const before = await this.workspace(true);
    const existing = before.relations.find(edge => ['relates_to', 'blocks', 'duplicate'].includes(edge.kind) &&
      ((edge.source === source.id && edge.target === target.id) || (edge.source === target.id && edge.target === source.id)));
    if (existing && (input.kind !== 'duplicate' || existing.kind === 'duplicate'))
      throw new ServiceError(409, 'Diese Tickets sind bereits verbunden. Es wurde keine weitere Verbindung angelegt.');
    try {
      if (input.kind === 'duplicate') {
        const result = await this.client.query<{ createNote: { errors: string[] } }>(
          `mutation MarkDuplicate($input: CreateNoteInput!) { createNote(input: $input) { errors } }`,
          { input: { noteableId: source.id, body: `/duplicate #${target.iid}` } });
        if (result.createNote.errors.length) throw new ServiceError(422, 'GitLab hat die Duplikat-Aktion abgelehnt. Bitte den aktuellen Stand prüfen.');
      } else {
        const linkType = { relates_to: 'RELATED', blocks: 'BLOCKS', is_blocked_by: 'BLOCKED_BY' }[input.kind];
        const result = await this.client.query<{ workItemAddLinkedItems: { errors: string[] } }>(
          `mutation AddConnection($input: WorkItemAddLinkedItemsInput!) {
            workItemAddLinkedItems(input: $input) { errors }
          }`, { input: { id: source.id, workItemsIds: [target.id], linkType } });
        if (result.workItemAddLinkedItems.errors.length)
          throw new ServiceError(422, 'GitLab hat die Verbindung abgelehnt. Bitte den aktuellen Stand prüfen.');
      }
    } finally { this.invalidate(); }
    let after: Workspace;
    try { after = await this.workspace(true); }
    catch { throw new ServiceError(502, 'Die Aktion wurde gesendet, aber nicht nachgeladen. Vor einem neuen Versuch den GitLab-Stand laden.'); }
    const kind = input.kind === 'is_blocked_by' ? 'blocks' : input.kind;
    const from = input.kind === 'is_blocked_by' ? target.id : source.id;
    const to = input.kind === 'is_blocked_by' ? source.id : target.id;
    const verified = after.relations.some(edge => edge.kind === kind &&
      ((edge.source === from && edge.target === to) || (kind === 'relates_to' && edge.source === to && edge.target === from)));
    const closed = after.issues.find(issue => issue.id === source.id)?.state.toLowerCase() === 'closed';
    if (!verified || (input.kind === 'duplicate' && !closed))
      throw new ServiceError(422, 'Die gewünschte Aktion wurde von GitLab nicht bestätigt. Bitte den aktuellen Stand laden.');
    return after;
  }

  private async creationTypes() {
    return collectPages<{ id: string; name: string; canUserCreateItems: boolean; enabled: boolean }>(async after => {
      const result = await this.client.query<{ project: { workItemTypes: Connection<{
        id: string; name: string; canUserCreateItems: boolean; enabled: boolean;
      }> } | null }>(`query CreationTypes($path: ID!, $after: String) { project(fullPath: $path) {
        workItemTypes(first: 100, after: $after) { nodes { id name canUserCreateItems enabled } ${PAGE} }
      } }`, { path: this.target.project, after });
      if (!result.project) throw new ServiceError(403, 'Kein Zugriff auf die Tickettypen dieses Projekts.');
      return result.project.workItemTypes;
    });
  }

  async creationOptions(iid?: string): Promise<CreationOptions> {
    const [source, types] = await Promise.all([iid ? this.issue(iid) : undefined, this.creationTypes()]);
    const available = (name: string) => types.some(type => type.name === name && type.enabled && type.canUserCreateItems);
    return { source, canCreateSubtask: (source?.canAddChild ?? false) && available('Task'),
      canCreateIssue: (!source || source.canLink) && available('Issue') };
  }

  async createConnected(iid: string, input: CreateConnectedInput): Promise<CreatedConnection> {
    return this.create(iid, input);
  }

  async createIssue(input: CreateIssueInput): Promise<CreatedConnection> {
    return this.create(undefined, input);
  }

  private async create(iid: string | undefined, input: CreateIssueInput | CreateConnectedInput): Promise<CreatedConnection> {
    for (const [key, entry] of this.creations) if (entry.expires < Date.now()) this.creations.delete(key);
    const fingerprint = JSON.stringify([iid, 'kind' in input ? input.expectedSourceUpdatedAt : null, 'kind' in input ? input.kind : null, input.title,
      input.description, [...input.labelIds].sort()]);
    const previous = this.creations.get(input.operationId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ServiceError(409, 'Diese Erstellungsanfrage wurde bereits anders verwendet. Den aktuellen GitLab-Stand prüfen.');
      return previous.result;
    }
    if (this.creations.size >= 100) throw new ServiceError(503, 'Zu viele Erstellungsanfragen. Bitte später erneut versuchen.');
    const result = this.performCreate(iid, input);
    this.creations.set(input.operationId, { fingerprint, expires: Date.now() + 3_600_000, result });
    return result;
  }

  private async performCreate(iid: string | undefined, input: CreateIssueInput | CreateConnectedInput): Promise<CreatedConnection> {
    const [source, types, snapshot] = await Promise.all([iid ? this.issue(iid) : undefined, this.creationTypes(), this.workspace()]);
    const connected = 'kind' in input ? input : undefined;
    if (source && connected && source.updatedAt !== connected.expectedSourceUpdatedAt) throw new ServiceError(409, 'Das Ausgangsticket wurde geändert. Bitte den aktuellen Stand laden.');
    if (source && connected && (connected.kind === 'subtask' ? !source.canAddChild : !source.canLink))
      throw new ServiceError(403, 'Du darfst hier keine verbundene Karte erstellen.');
    const type = types.find(value => value.name === (connected?.kind === 'subtask' ? 'Task' : 'Issue') && value.enabled && value.canUserCreateItems);
    if (!type) throw new ServiceError(403, 'Dieser Tickettyp kann in diesem Projekt nicht erstellt werden.');
    if (input.labelIds.some(id => !snapshot.labels.some(label => label.id === id)))
      throw new ServiceError(400, 'Die Labelauswahl gehört nicht zu diesem Projekt.');
    const createInput: Record<string, unknown> = { namespacePath: this.target.project, workItemTypeId: type.id,
      title: input.title.trim(), descriptionWidget: { description: input.description },
      labelsWidget: { labelIds: input.labelIds }, clientMutationId: input.operationId };
    if (source && connected) {
      if (connected.kind === 'subtask') createInput.hierarchyWidget = { parentId: source.id };
      else createInput.linkedItemsWidget = { workItemsIds: [source.id],
        linkType: { relates_to: 'RELATED', blocks: 'BLOCKED_BY', is_blocked_by: 'BLOCKS' }[connected.kind] };
    }
    let created: { id: string; iid: string } | null = null;
    try {
      const result = await this.client.query<{ workItemCreate: { errors: string[]; workItem: { id: string; iid: string } | null } }>(
        `mutation CreateConnected($input: WorkItemCreateInput!) { workItemCreate(input: $input) { errors workItem { id iid } } }`,
        { input: createInput });
      created = result.workItemCreate.workItem;
      if (result.workItemCreate.errors.length || !created)
        throw new ServiceError(422, created ? `Ticket #${created.iid} wurde angelegt, aber die Erstellung ist nicht bestätigt. Bitte in GitLab prüfen und nicht erneut anlegen.`
          : 'GitLab hat die Erstellung nicht bestätigt. Vor einem neuen Versuch den aktuellen Stand prüfen.');
    } finally { this.invalidate(); }
    let workspace: Workspace;
    try { workspace = await this.workspace(true); }
    catch { throw new ServiceError(502, `Ticket #${created.iid} wurde angelegt, aber nicht nachgeladen. Bitte in GitLab prüfen und nicht erneut anlegen.`); }
    const kind = connected?.kind === 'subtask' ? 'parent' : connected?.kind === 'is_blocked_by' ? 'blocks' : connected?.kind;
    const from = connected?.kind === 'is_blocked_by' ? created.id : source?.id;
    const to = connected?.kind === 'is_blocked_by' ? source?.id : created.id;
    if (!workspace.issues.some(issue => issue.id === created.id) || (source && !workspace.relations.some(edge => edge.kind === kind &&
      ((edge.source === from && edge.target === to) || (kind === 'relates_to' && edge.source === to && edge.target === from)))))
      throw new ServiceError(422, `Ticket #${created.iid} wurde angelegt, aber die Erstellung ist nicht bestätigt. Bitte in GitLab prüfen und nicht erneut anlegen.`);
    return { workspace, createdIid: created.iid };
  }
}
