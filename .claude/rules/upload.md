# File Uploads

## Limits + mime allowlists
- ALWAYS read from `UPLOAD_LIMITS` in `@/core/constants/upload.constant.ts`. NEVER redeclare `MAX_SIZE`, `ALLOWED_MIMES`, etc. per controller.
- Three categories cover every upload in the app:
  - `UPLOAD_LIMITS.ATTACHMENT` — issue attachments (10 MB, 10 files, wide mime allowlist)
  - `UPLOAD_LIMITS.AVATAR` — user avatar (2 MB, image-only)
  - `UPLOAD_LIMITS.LOGO` — app logo (2 MB, image-only, includes SVG)
- Use the `isAllowedMime(limits, file.mimetype)` helper in `fileFilter`. Do not write raw `new Set([...]).has(...)` checks.

## Throttle
- Every upload endpoint MUST have `@Throttle({ default: { ttl: 60000, limit: N } })` — see `.claude/rules/throttle.md` for the per-endpoint table. Upload is expensive and a prime DoS vector.

## Storage
- ALL file writes go through `uploadFile(buffer, fileName, mime)` from `@/core/utils/storage.util.ts`. That helper handles path sanitization, bucket routing, and signed-URL generation.
- On delete: call `deleteFile(publicUrl)` — best-effort. Don't let storage cleanup errors fail the DB delete — wrap in try/catch and swallow.
- Signed URLs: use `createSignedUrl(publicUrl, ttlSec)` for private-bucket access. Default TTL 300s (5 min) for on-demand, 600s (10 min) for enrichment in list responses.

## Adding a new upload endpoint
1. If it doesn't fit any existing category, ADD a new entry to `UPLOAD_LIMITS` first. Don't inline.
2. Controller: `@UseInterceptors(FileInterceptor(...))` with `limits.fileSize = UPLOAD_LIMITS.X.maxSize` + `fileFilter = isAllowedMime(UPLOAD_LIMITS.X, ...)`.
3. Controller: `@Throttle(...)` per throttle.md.
4. Service: `uploadFile()` to write, `deleteFile()` on replacement/delete.
5. Audit: call `this.audit.log(userId, 'X_UPLOAD', ...)` if the action is admin-visible.
