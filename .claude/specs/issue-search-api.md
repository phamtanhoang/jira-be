# API: Issue Search

## Status: done

## Endpoint
`GET /issues?search=&projectId=&sprintId=&assigneeId=&type=&priority=`

## Behavior
- `search` param: case-insensitive match on issue `summary` and `key` fields (Prisma.QueryMode.insensitive)
- `projectId` is optional — when omitted, returns issues across all projects user has access to
- `sprintId=backlog` returns issues with null sprintId
- All filters are optional and combinable
- Returns full issue with ISSUE_INCLUDE (reporter, assignee, boardColumn, sprint, parent, epic, labels, _count)

## Used By (FE)
- Board filter bar: search + type + priority + assignee
- Global search (Cmd+K CommandPalette): search param only, no projectId

## Files
- `src/modules/issues/issues.controller.ts` — GET /issues endpoint
- `src/modules/issues/issues.service.ts` — findAll() method with filter object
