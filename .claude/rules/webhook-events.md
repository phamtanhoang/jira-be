# Outbound Webhooks

Subscribers register a URL + secret per workspace + event types. `WebhooksService.dispatch()` is fire-and-forget — domain code calls it, the service handles retries + persistence.

## Files

- `src/modules/webhooks/webhooks.service.ts` — dispatcher, retry logic, signature
- `src/modules/webhooks/dto/index.ts` — `WEBHOOK_EVENTS` enum (the typed allow-list)
- `prisma/webhook.prisma` + `prisma/webhook-delivery.prisma` — schema

## Adding a new event type

1. Add the event name to `WEBHOOK_EVENTS` const in `dto/index.ts`:
   ```ts
   export const WEBHOOK_EVENTS = [
     // ...existing
     'project.archived',
   ] as const;
   ```
2. Emit at the source service:
   ```ts
   this.webhooks.dispatch(workspaceId, 'project.archived', {
     id: project.id,
     key: project.key,
     archivedBy: { id: userId },
     archivedAt: new Date().toISOString(),
   });
   ```
3. The payload is JSON-serialized + HMAC-SHA256 signed with the subscriber's secret. Standard `X-Webhook-Signature: sha256=...` header.

## Reliability

- 3 retry attempts with delays `[1s, 5s, 30s]` (`RETRY_DELAYS_MS`).
- Each attempt is persisted as a `WebhookDelivery` row with `statusCode`, `error`, `attempts`, final `status: PENDING|SUCCESS|FAILED`.
- After all retries: stays `FAILED`, admin can manually retry from `/admin/webhooks/deliveries`.

## Slack-style enhancement

Detect Slack webhook URLs (host `hooks.slack.com`) → reshape payload as `{ text, attachments }` so Slack channels render nicely. Existing logic at `webhooks.service.ts:formatSlackPayload`.

## Cost discipline

Each delivery + retry hits DB (insert + updates) AND fires an outbound HTTP request. Don't dispatch on every read or noisy mutation:
- ✅ Coarse domain events: `issue.created`, `sprint.completed`, `attachment.uploaded`
- ❌ Per-field updates: `issue.summary.updated` — too granular, use `issue.updated` with `changed: ['summary']` in payload

## Admin toggle

`LoggingConfigService.isEnabled('webhookDelivery')` gates the whole pipeline. When OFF, `dispatch()` returns immediately — no subscriber lookup, no HTTP call, no DB row. Useful for free-tier Neon environments where webhook deliveries would burn compute.

## Things easy to get wrong

- ❌ Calling `await this.webhooks.dispatch(...)` — it's fire-and-forget. Domain mutation should not wait for HTTP fanout.
- ❌ Forgetting to add the event to `WEBHOOK_EVENTS` — dispatcher silently filters unknown names (`if (!knownEvents.includes(eventType)) return;`).
- ❌ Including secrets in the payload — webhook URLs are user-controlled, anyone with the URL gets the bytes.
- ❌ Dispatching INSIDE a Prisma transaction — webhook HTTP call can take seconds. Dispatch AFTER the transaction commits.
