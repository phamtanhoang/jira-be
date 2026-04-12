# API: Issue Sprint Assignment & Move

## Status: done

## Endpoints

### PATCH /issues/:id — Update issue fields
- Used by FE backlog DnD to update `sprintId` (assign issue to sprint or null for backlog)
- Also used for inline field edits (summary, description, priority, type, assigneeId, storyPoints, dueDate, startDate)
- Logs activity for each changed field (UPDATED or ASSIGNED action)

### PATCH /issues/:id/move — Move issue to board column
- Used by FE board drag-drop and subtask checkbox toggle
- Accepts `{ columnId, position }`
- Auto-sets `completedAt` when moved to DONE category column
- Clears `completedAt` when moved away from DONE
- Logs TRANSITIONED activity with old/new column names

## Used By (FE)
- Backlog DnD: `updateIssue({ sprintId })` via PATCH /issues/:id
- Board DnD: `moveIssue({ columnId, position })` via PATCH /issues/:id/move
- Subtask checkbox: `moveIssue` to toggle between TODO↔DONE columns

## Files
- `src/modules/issues/issues.controller.ts` — PATCH endpoints
- `src/modules/issues/issues.service.ts` — update() and move() methods
