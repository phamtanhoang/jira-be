/**
 * Realtime event vocabulary — keep this list TINY and project-stable.
 *
 * The FE invalidates React Query keys on receipt; the BE emits via
 * `EventEmitter2` from each domain service. We deliberately use coarse
 * event types (`issue.updated`) instead of per-field (`issue.summary.updated`)
 * — the FE just needs to know "something on issue X changed, refetch".
 *
 * Payload shape is intentionally small: only the IDs needed to compute
 * which cache keys to invalidate. No business data on the wire.
 */
export const REALTIME_EVENTS = {
  ISSUE_UPDATED: 'issue.updated',
  ISSUE_CREATED: 'issue.created',
  ISSUE_DELETED: 'issue.deleted',
  ISSUE_MOVED: 'issue.moved',
  COMMENT_ADDED: 'comment.added',
  COMMENT_UPDATED: 'comment.updated',
  COMMENT_DELETED: 'comment.deleted',
  ATTACHMENT_ADDED: 'attachment.added',
  ATTACHMENT_DELETED: 'attachment.deleted',
  SPRINT_UPDATED: 'sprint.updated',
  /** Any board structure change — column add/remove/reorder/rename. */
  BOARD_CHANGED: 'board.changed',
  /** Per-user notification row landed in DB. Routes via `recipientId`. */
  NOTIFICATION_CREATED: 'notification.created',
  /** Worklog row created / updated / deleted on an issue. */
  WORKLOG_CHANGED: 'worklog.changed',
} as const;

export type RealtimeEventType =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/**
 * Every event carries enough scope to fan it out to the right channels:
 *  - `recipientId` → /events/me (events explicitly addressed to a user,
 *    e.g. notifications, watched-issue activity)
 *  - `workspaceId` → /events/workspace/:id (reserved; not yet used)
 *  - `projectId` → /events/project/:id (board / backlog viewers)
 *  - `issueId` + `issueKey` → /events/issue/:id (detail viewers)
 *
 * The SSE controller filters by matching the subscriber's channel
 * against the payload scopes. `actorId` is informational — used by
 * filters to skip echoing the actor's own actions back, and by FE to
 * decide whether a toast should fire.
 */
export interface RealtimeEvent {
  type: RealtimeEventType;
  /** Who triggered the change. */
  actorId: string;
  /** Specific user this event is for. Required for `/events/me` routing —
   *  without it the event won't reach the per-user channel. */
  recipientId?: string;
  workspaceId?: string;
  projectId?: string;
  issueId?: string;
  issueKey?: string;
  /** Optional small payload — never include unsanitized user input. */
  data?: Record<string, unknown>;
}
