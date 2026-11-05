export interface GitLabTarget { gitlabUrl: string; project: string }
export function gitLabTargetKey(target: GitLabTarget): string {
  return JSON.stringify([target.gitlabUrl, target.project]);
}

export interface Label { id: string; name: string; color: string }
export interface Status { id: string; name: string; color: string; category: string }
export interface Person { id: string; name: string; username: string }
export interface Milestone { id: string; title: string }
export interface Issue {
  id: string;
  iid: string;
  title: string;
  description: string;
  state: string;
  updatedAt: string;
  webUrl: string;
  status: Status | null;
  labels: Label[];
  assignees: Person[];
  milestone: Milestone | null;
  canEdit: boolean;
  canSetMetadata: boolean;
  canLink: boolean;
  canDuplicate: boolean;
  duplicateOf: string | null;
  typeName: string;
  canAddChild: boolean;
}
export type RelationKind = 'relates_to' | 'blocks' | 'parent' | 'duplicate';
export type ConnectionKind = 'relates_to' | 'blocks' | 'is_blocked_by' | 'duplicate';
export interface ConnectionInput {
  targetIid: string;
  kind: ConnectionKind;
  expectedSourceUpdatedAt: string;
  expectedTargetUpdatedAt: string;
  confirmDuplicate?: boolean;
}
export type NewConnectionKind = 'subtask' | 'relates_to' | 'blocks' | 'is_blocked_by';
export interface CreateIssueInput {
  operationId: string;
  title: string;
  description: string;
  labelIds: string[];
}
export interface CreateConnectedInput extends CreateIssueInput {
  expectedSourceUpdatedAt: string;
  kind: NewConnectionKind;
}
export interface CreationOptions { source?: Issue; canCreateSubtask: boolean; canCreateIssue: boolean }
export interface CreatedConnection { workspace: Workspace; createdIid: string }
export interface DropPosition { x: number; y: number }
export interface Reference { id: string; iid: string; title: string; webUrl: string }
export interface Relation { id: string; source: string; target: string; kind: RelationKind }
export interface Workspace extends GitLabTarget {
  fetchedAt: string;
  issues: Issue[];
  references: Reference[];
  relations: Relation[];
  labels: Label[];
  statuses: Status[];
}
export interface IssuePatch {
  expectedUpdatedAt: string;
  title?: string;
  description?: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  statusId?: string;
}
export interface ApiError { message: string; current?: Issue; code?: string }
export type View = 'network' | 'themes' | 'hierarchy';
export interface Filters {
  query: string;
  statuses: string[];
  labels: string[];
  assignees: string[];
  milestones: string[];
  relations: RelationKind[];
  context: boolean;
}
export interface ViewState { view: View; filters: Filters; selected: string; theme: string; collapsed: string[]; overview: boolean }
