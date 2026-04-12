# API: Sprint Burndown Chart Data

## Status: done

## Endpoint
`GET /sprints/:id/burndown`

## Response
```json
{
  "totalPoints": 42,
  "days": [
    { "date": "2026-04-10", "ideal": 42, "actual": 42 },
    { "date": "2026-04-11", "ideal": 36, "actual": 38 },
    ...
  ]
}
```

## Calculation Logic
- `totalPoints`: sum of all sprint issues' storyPoints (default 1 if null)
- `ideal`: linear from totalPoints to 0 across sprint duration
- `actual`: totalPoints minus points of issues with completedAt <= that date
- Date range: sprint.startDate → sprint.endDate (or now if still active)
- Empty response if sprint has no startDate

## Files
- `src/core/constants/endpoint.constant.ts` — BURNDOWN route
- `src/modules/sprints/sprints.controller.ts` — GET endpoint
- `src/modules/sprints/sprints.service.ts` — getBurndown() method
