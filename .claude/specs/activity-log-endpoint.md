# API: Activity Log Endpoint

## Status: done

## Problem
FE called `GET /issues/:id/activity` but BE had no such endpoint — returned 404. Activity was only embedded inline in `findByKey()` response (limit 20).

## Fix
Added dedicated `GET /issues/:id/activity` endpoint.

## Endpoint
`GET /issues/:id/activity`

## Response
```json
[
  {
    "id": "uuid",
    "issueId": "uuid",
    "userId": "uuid",
    "action": "UPDATED",
    "field": "priority",
    "oldValue": "MEDIUM",
    "newValue": "HIGH",
    "createdAt": "2026-04-13T...",
    "user": { "id": "uuid", "name": "John", "image": null }
  }
]
```

## Actions Logged (6 places)
- CREATED — issue creation (issues.service.ts)
- UPDATED — field changes (issues.service.ts)
- ASSIGNED — assignee change (issues.service.ts)
- TRANSITIONED — status/column change (issues.service.ts)
- COMMENTED — comment added (comments.service.ts)
- LOGGED_WORK — worklog added (worklogs.service.ts)
- ATTACHED — file uploaded (attachments.service.ts)

## Files Modified
- `src/modules/issues/issues.service.ts` — added findActivity() method
- `src/modules/issues/issues.controller.ts` — added GET activity route
