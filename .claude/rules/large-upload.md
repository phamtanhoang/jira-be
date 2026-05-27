# Large / Chunked Attachment Upload

DB-backed resumable upload pipeline for files exceeding the single-shot `ATTACHMENT.maxSize` (10 MB). Lives in `src/modules/attachments-large/`.

## Architecture

```
init → /:id/chunk × N → /:id/complete
                          │
                          ▼
                    Atomic DB transaction:
                      Attachment.create()
                      Activity.create()
                      UploadSession.update(COMPLETED)
                    Cleanup temp chunks on Supabase
```

Session state lives in **Postgres** (`UploadSession` model), NOT in-memory. Survives BE container restart.

## Files involved

- `src/modules/attachments-large/attachments-large.service.ts` — business logic
- `src/modules/attachments-large/attachments-large.controller.ts` — 6 endpoints (init, chunk, complete, abort, abort-beacon, status)
- `src/core/utils/storage.util.ts` — `uploadChunkObject`, `downloadChunkObject`, `deleteChunkObjects`, `listChunkIndices`
- `prisma/upload-session.prisma` — schema
- Constants: `UPLOAD_LIMITS.LARGE_ATTACHMENT` in `upload.constant.ts`

## Limits (current)

| Setting | Value | Why |
|---|---|---|
| `maxSize` | 30 MB | Bounds in-memory `Buffer.concat` peak at `/complete` |
| `chunkSize` | 512 KB | Fits under nginx default `client_max_body_size` (1 MB) |
| `chunkUploadCap` (multer) | 768 KB | chunk + multipart envelope headroom |
| `sessionTtlMs` | 1 hour | Resume window before cron sweep |
| Sweep cadence | every 30 min | Cleanup PENDING/FAILED sessions past TTL |

If you bump `maxSize` past 100 MB, also rethink:
- BE RAM peak at `complete` (3× file size due to Buffer.concat + Supabase serializer copy)
- nginx `client_max_body_size` (if you bump `chunkSize`)
- Free-tier Neon compute (each chunk = 1 DB update)

## Self-healing protocol

Supabase free-tier storage sometimes returns 200 OK on upload without persisting the object. `/complete` is defensive:

1. After all chunks in, BE lists `temp/{sessionId}/` folder to verify presence.
2. If any chunk missing → throw `409 ConflictException` with `{ missingChunks: number[] }`.
3. FE re-uploads only those chunks, then calls `/complete` again.
4. Maximum 2 self-heal cycles before giving up.
5. If `downloadChunkObject` fails despite list saying present (list/download caches disagree), filter retries 6× with backoff before throwing 409 too.

## Idempotency / concurrency

`/complete` uses a conditional `updateMany(status PENDING → COMPLETING)` as atomic mutex. Two concurrent `/complete` calls for the same `sessionId`:
- First call: `claim.count === 1` → proceeds.
- Second call: `claim.count === 0` → checks session status:
  - `COMPLETED` + `attachmentId` set → returns the cached Attachment (idempotent).
  - `COMPLETING` → throws `409 LARGE_UPLOAD_IN_PROGRESS`.

Never create two Attachment rows for one session.

## Resume support

FE persists `sessionId` to `localStorage`. On page reload:
1. FE calls `GET /:sessionId/status` to learn which chunks BE already has.
2. User re-picks the same file from disk (browser security forbids persisting File).
3. BE verifies `file.name + file.size` match the persisted session.
4. FE skips already-uploaded chunks, uploads only missing.

`pagehide` + `navigator.sendBeacon` fires `POST /:sessionId/abort-beacon` when the tab closes ungracefully, so BE can cleanup eagerly instead of waiting for TTL.

## Quota check

`init` calls `assertQuota(workspaceId, fileSize)` which checks the workspace's total `Attachment.fileSize` against `app.quotas.maxStorageGB`. Emits `quota.exceeded` event on hit.

## Things easy to get wrong

- ❌ Storing `sessionId` in an in-memory Map (the legacy pre-refactor design). Container restart = lose all in-flight uploads. We migrated to DB intentionally.
- ❌ Forgetting to update `UploadSession.status` on the failure path. Stuck in PENDING → cron sweep eventually picks up after TTL.
- ❌ Cleaning up temp chunks BEFORE the DB transaction commits. If DB write fails after Supabase upload, you lose the file. Code order: assemble → uploadFile (permanent) → DB transaction → on transaction failure: `deleteFile(fileUrl)` to clean the permanent path.
- ❌ Returning the chunk's bytes back in the response (`responseBody`). Use `metadata` instead, kept small.
