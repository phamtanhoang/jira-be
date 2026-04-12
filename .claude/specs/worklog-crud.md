# API: Worklog CRUD

## Status: done

## Endpoints
- `POST /issues/:id/worklogs` — Create worklog (timeSpent in seconds, startedAt, description)
- `GET /issues/:id/worklogs` — List worklogs for issue
- `PATCH /worklogs/:id` — Update own worklog (timeSpent, startedAt, description)
- `DELETE /worklogs/:id` — Delete own worklog

## Authorization
- Create: any workspace member
- Update/Delete: author only (userId check)
- Logs LOGGED_WORK activity on create

## Used By (FE)
- Issue detail sidebar → WorklogSection component
- Add worklog: hours + minutes + description form
- Edit worklog: inline edit with hours/minutes/description
- Delete worklog: trash icon (author only)

## Files
- `src/modules/worklogs/worklogs.controller.ts` — 2 controllers (issue-scoped + resource-scoped)
- `src/modules/worklogs/worklogs.service.ts` — CRUD + author check
