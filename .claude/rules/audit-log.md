# Admin Audit Log

## When to log
- ALL admin-visible destructive or identity-changing actions. See `AuditAction` union in `modules/admin-audit/admin-audit.service.ts`.
- Currently covered: ROLE_CHANGE, USER_DELETE / USER_ACTIVATE / USER_DEACTIVATE, SESSION_REVOKE / SESSIONS_REVOKE_ALL, WORKSPACE_DELETE, PROJECT_DELETE, ATTACHMENT_DELETE, AVATAR_UPDATE, SETTING_UPDATE, FLAG_CREATE / FLAG_UPDATE / FLAG_DELETE.
- Adding a new destructive admin action → add a new `AuditAction` literal AND call `this.audit.log(actorId, 'X', {target, targetType, payload})` from the service.

## Payload enrichment
- Payload MUST include fields that make the record human-readable WITHOUT a fresh lookup:
  - For target = User: `{ targetName, targetEmail }`
  - For target = Project: `{ targetName, targetKey, workspaceId }`
  - For target = Attachment: `{ fileName, mimeType, fileSize, issueId }`
  - For state-change actions: `{ from, to }` (e.g. ROLE_CHANGE payload carries `from: 'DEVELOPER', to: 'ADMIN'`)
- Rationale: UI renders `describeAudit()` (on FE) based on payload. Missing fields → UI falls back to raw UUID.

## Activity feed field resolution
- `issues.service.ts::findActivity` resolves `assigneeId`/`reporterId`/`sprintId`/`parentId`/`epicId` UUIDs to current names at QUERY time (not at log time).
- Reason: users can rename themselves; resolving at query time shows the current display name, not a stale snapshot.
- If you add a new field that stores a foreign ID in `Activity.oldValue`/`newValue`, add the field name to the appropriate Set in `findActivity` (USER_FIELDS, SPRINT_FIELDS, ISSUE_FIELDS) and add the batch lookup to the Promise.all.

## Audit service contract
- `AdminAuditService.log()` is fire-and-forget — it never throws, swallows its own errors, does NOT await.
- NEVER `await this.audit.log(...)` — that would couple a logging failure to the user's request.
- The `@Global` AdminAuditModule means any service can inject `AdminAuditService` without importing the module.
