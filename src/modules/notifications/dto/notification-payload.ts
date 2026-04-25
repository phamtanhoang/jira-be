// Internal payload — not bound to an HTTP request. The shape lives in
// dto/ next to the module so other services that emit notifications can
// import it without pulling the controller in.
export type NotificationType =
  | 'ISSUE_ASSIGNED'
  | 'ISSUE_UPDATED'
  | 'ISSUE_TRANSITIONED'
  | 'COMMENT_CREATED'
  | 'MENTION_ISSUE'
  | 'MENTION_COMMENT'
  | 'WATCH_ACTIVITY';

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
};
