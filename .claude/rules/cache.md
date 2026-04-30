# Cache (Redis)

`AppCacheModule` (registered globally in `AppModule`) installs `cache-manager`
with a Redis store when `REDIS_URL` is set, otherwise an in-memory map. The
single entry point for app code is `CacheTagsService`.

## When to cache

PREFER caching reads that are:
- Hot — called from the FE on every page load (workspace list, project list,
  app settings).
- Cheap to invalidate — there's a finite, bounded set of mutations that can
  change the result (workspace mutations invalidate `user:<userId>`).
- Idempotent — same input always yields the same output, so a stale read is
  the only failure mode.

DO NOT cache:
- Per-request data that bakes the requester into the row shape (e.g.
  `withUserMeta` adds `stars: { where: { userId } }`). If you must, the
  cache key MUST include `user:<userId>`.
- Dashboards / activity feeds — too many invalidation surfaces, the chance
  of staleness outweighs the latency win.
- Any list with `cursor:` pagination — different cursors are different keys
  and invalidation tags would explode.

## Wrapping a read

```ts
return this.cacheTags.wrap(
  `ws:list:user:${userId}`,
  [`user:${userId}`, 'workspaces'],
  () => this.prisma.workspace.findMany({ ... }),
  /* ttlSec */ 60,
);
```

Key naming: `<namespace>:<scope>:<id>[:<param>...]`. Tags are flat strings
that mutations later pass to `invalidateTag`. The wrapper handles namespacing
internally (`cache:v1:` prefix).

## Invalidating

ALWAYS call `invalidateTag` (or `invalidateTags`) right after the mutation
commits. Use `void` so a slow cache backend can't block the response:

```ts
const updated = await this.prisma.workspace.update(...);
void this.cacheTags.invalidateTag(`workspace:${workspaceId}`);
return updated;
```

Tag matrix for the issue domain:
- `user:<userId>` — workspace list per user
- `workspace:<wsId>` — project list, workspace detail
- `project:<projectId>` — issue list per project, board layout
- `issue:<issueId>` — issue detail, activity feed

Mutations that affect multiple tags pass them in one call:
`invalidateTags(['workspace:<id>', 'workspaces'])`.

## TTLs

- List endpoints (60s): a missed invalidation self-heals quickly. Use the
  default `ENV.CACHE_TTL_DEFAULT`.
- Single-resource detail (300s): pages refresh manually; trade staleness for
  hit rate.
- Settings / app-info (600s): admin-rare-write.

## Kill switch

Set `CACHE_DISABLED=1` in the environment to bypass every read and write.
Useful for production diagnosis when stale data is suspected — flip the env
var, verify, then either fix invalidation or roll back the wrapper.

## Don't

- DO NOT call `cache-manager` directly. Always go through `CacheTagsService`
  so tag tracking stays in sync.
- DO NOT `await` invalidation — `void` it. A slow Redis must not slow down
  the user's mutation response.
- DO NOT cache an endpoint whose response shape includes the actor (e.g.
  `findById` that includes `stars: { where: { userId } }`) without baking
  `user:<userId>` into the cache key.
