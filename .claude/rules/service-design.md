# Service Design

## Size heuristic

Services that grow past ~500 LOC become hard to test and reason about. When a service hits that line count AND its public methods cluster into 2+ behavioral groups (CRUD vs Search vs Activity vs Bulk), split along those boundaries:

- Keep the original class name (`XService`) as a façade — every public method becomes a one-line delegate to the appropriate sub-service. This preserves the controller contract and external callers (other modules injecting `XService`) work unchanged.
- Sub-services live in `src/modules/<x>/services/x-<aspect>.service.ts`.
- Shared helpers (selects, includes, type aliases, constants) move to `src/modules/<x>/x.shared.ts` to avoid circular imports between sub-services.
- Module file registers all sub-services as providers; exports only the façade (`XService`).
- Sub-services inject only what they actually need — don't propagate every dependency.

NEVER split before 500 LOC just for "cleanliness" — single-file services are easier to read and refactor as a unit. Wait until the size pain is real.

## Repository pattern (when)

Most services don't need a repository — Prisma's typed client + the centralized `*_SELECT_*` constants in `prisma-selects.constant.ts` already give you DRY data access. Add a `XRepository` only when:

- The service builds dynamic `where` / `orderBy` clauses programmatically (e.g. filter builders).
- The same complex query (3+ joins, custom raw SQL, batched lookups) is called from multiple services.
- The query has its own observable surface (timing, caching) that benefits from being a single function.

Repository contract:
- Returns Prisma rows or `null`. NEVER throws HTTP exceptions — that's the service's job.
- Doesn't know about `userId` for permission. Access control stays in the service.
- Inline simple `findUnique` / `count` / `findFirst` calls in the service is fine — repository is not a religion.

Pilot scope today: `IssuesRepository`, `ProjectsRepository`. Extend only after the pilot proves out.

## Atomicity

State changes that write multiple rows MUST happen inside `$transaction(async (tx) => { ... })`:

- `update + activity.create` — column moves, sprint changes, assignment changes. Without atomicity, a column move could succeed but the activity log fail (or vice versa), leaving observers confused.
- `delete + cascading manual cleanup` — anywhere FK cascade isn't enough.
- `create + counter increment + child relation seed` — issue creation with auto-key.

Notification / webhook fanout runs AFTER the transaction commits — those are best-effort, must not roll back domain writes on failure.

## Parallelism

Independent reads → `Promise.all([...])`. Sequential awaits where the next call doesn't depend on the previous result is a latency leak.

Canonical example: `IssuesMoveService.move` reads new column + old column in parallel before the update.
