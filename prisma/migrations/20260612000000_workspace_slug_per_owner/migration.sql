-- Workspace.slug is no longer globally unique. It is only used for display
-- (admin search, invite-link payloads) — routes use the UUID id. Two
-- unrelated users can legitimately want a workspace called "Marketing"
-- without colliding. Uniqueness moves to (ownerId, slug).

-- DropIndex
DROP INDEX IF EXISTS "Workspace_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerId_slug_key" ON "Workspace"("ownerId", "slug");
