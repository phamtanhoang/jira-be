# Admin Audit Log

## When to log
- ALL admin-visible destructive or identity-changing actions. See `AuditAction` union in `modules/admin-audit/admin-audit.service.ts`.
- Currently covered: ROLE_CHANGE, USER_DELETE / USER_ACTIVATE / USER_DEACTIVATE, USERS_BULK_INVITE, SESSION_REVOKE / SESSIONS_REVOKE_ALL, WORKSPACE_DELETE, PROJECT_DELETE, ATTACHMENT_DELETE, AVATAR_UPDATE, SETTING_UPDATE, FLAG_CREATE / FLAG_UPDATE / FLAG_DELETE, THROTTLE_OVERRIDE_CREATE / UPDATE / DELETE, WEBHOOK_CREATE / UPDATE / DELETE / TEST / ROTATE_SECRET.
- Adding a new destructive admin action → add a new `AuditAction` literal AND call `this.audit.log(actorId, 'X', {target, targetType, payload})` from the service.

## FE sync — REQUIRED
When you add a new `AuditAction` literal in this repo, you MUST also update the FE side or the `/admin/logs` audit panel crashes the next time a row with that action loads. Two files to keep in sync:
1. `jira-fe/src/features/admin-audit/types.ts` — `AuditAction` union.
2. `jira-fe/src/features/admin-audit/action-config.ts` — `AUDIT_ACTION_CONFIG` (icon + label + tone) AND `describeAudit` switch.

There's also a defensive `getAuditActionConfig()` fallback for forward compat — but DO NOT rely on it; the fallback shows a generic icon and the user gets no useful summary.

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
