import { ProjectRole, WorkspaceRole } from '@prisma/client';

/**
 * Capabilities a workspace role can perform. Add an entry when a new
 * workspace-scoped action ships; reference it from the service via
 * `canDoWorkspace(role, 'TRANSFER_OWNERSHIP')` so role matrices stay in
 * one place.
 *
 * Naming: NOUN_VERB or VERB_NOUN — pick the form that reads better.
 * Examples below use VERB_NOUN to match the existing JS naming style.
 */
export type WorkspaceAction =
  | 'UPDATE_WORKSPACE'
  | 'DELETE_WORKSPACE'
  | 'TRANSFER_OWNERSHIP'
  | 'INVITE_MEMBER'
  | 'REMOVE_MEMBER'
  | 'UPDATE_MEMBER_ROLE'
  | 'CREATE_PROJECT'
  | 'MANAGE_WEBHOOKS'
  | 'MANAGE_INVITE_LINKS';

export type ProjectAction =
  | 'UPDATE_PROJECT'
  | 'DELETE_PROJECT'
  | 'INVITE_MEMBER'
  | 'REMOVE_MEMBER'
  | 'UPDATE_MEMBER_ROLE'
  | 'MANAGE_BOARD'
  | 'MANAGE_SPRINT'
  | 'MANAGE_LABELS'
  | 'CREATE_ISSUE'
  | 'DELETE_ISSUE';

// Higher number = stronger role. Lets `canDoWorkspace` express "minimum
// role required" rather than an explicit list per action.
const WORKSPACE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 40,
  ADMIN: 30,
  MEMBER: 20,
  VIEWER: 10,
};

const PROJECT_RANK: Record<ProjectRole, number> = {
  LEAD: 40,
  ADMIN: 30,
  DEVELOPER: 20,
  VIEWER: 10,
};

const WORKSPACE_REQUIRED_RANK: Record<WorkspaceAction, number> = {
  TRANSFER_OWNERSHIP: 40, // OWNER only
  DELETE_WORKSPACE: 40, // OWNER only
  UPDATE_WORKSPACE: 30, // OWNER or ADMIN
  INVITE_MEMBER: 30,
  REMOVE_MEMBER: 30,
  UPDATE_MEMBER_ROLE: 30,
  MANAGE_WEBHOOKS: 30,
  MANAGE_INVITE_LINKS: 30,
  CREATE_PROJECT: 20, // any MEMBER+
};

const PROJECT_REQUIRED_RANK: Record<ProjectAction, number> = {
  DELETE_PROJECT: 40, // LEAD only
  UPDATE_PROJECT: 30,
  INVITE_MEMBER: 30,
  REMOVE_MEMBER: 30,
  UPDATE_MEMBER_ROLE: 30,
  MANAGE_BOARD: 30,
  MANAGE_SPRINT: 30,
  MANAGE_LABELS: 30,
  CREATE_ISSUE: 20, // DEVELOPER+
  DELETE_ISSUE: 30,
};

export function canDoWorkspace(
  role: WorkspaceRole | undefined,
  action: WorkspaceAction,
): boolean {
  if (!role) return false;
  return WORKSPACE_RANK[role] >= WORKSPACE_REQUIRED_RANK[action];
}

export function canDoProject(
  role: ProjectRole | undefined,
  action: ProjectAction,
): boolean {
  if (!role) return false;
  return PROJECT_RANK[role] >= PROJECT_REQUIRED_RANK[action];
}

/**
 * Returns the list of workspace roles that satisfy the action. Useful to
 * pass to `WorkspacesService.assertRole(workspaceId, userId, ...)` without
 * spelling out the role array at every call site.
 *
 * ```ts
 * await this.workspaces.assertRole(
 *   workspaceId,
 *   userId,
 *   rolesAllowedWorkspace('UPDATE_WORKSPACE'),
 * );
 * ```
 */
export function rolesAllowedWorkspace(
  action: WorkspaceAction,
): WorkspaceRole[] {
  const required = WORKSPACE_REQUIRED_RANK[action];
  return (Object.keys(WORKSPACE_RANK) as WorkspaceRole[]).filter(
    (r) => WORKSPACE_RANK[r] >= required,
  );
}

export function rolesAllowedProject(action: ProjectAction): ProjectRole[] {
  const required = PROJECT_REQUIRED_RANK[action];
  return (Object.keys(PROJECT_RANK) as ProjectRole[]).filter(
    (r) => PROJECT_RANK[r] >= required,
  );
}
