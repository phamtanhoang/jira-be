import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { CreateWebhookDto, UpdateWebhookDto, WEBHOOK_EVENTS } from './dto';

const MANAGE_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
];
const RETRY_DELAYS_MS = [1000, 5000, 30_000]; // 3 attempts total
const MAX_BODY_PREVIEW = 500;

type SlackishPayload = {
  text: string;
  attachments?: { color: string; text: string }[];
};

/**
 * Outbound webhook dispatcher.
 *
 * Lifecycle of a fire:
 *  1. Caller invokes `dispatch(workspaceId, eventType, payload)` — synchronous
 *     return; we do NOT await the actual HTTP send.
 *  2. We resolve all enabled hooks subscribed to the event, INSERT a row in
 *     `WebhookDelivery (status=PENDING)` per hook, then schedule the send
 *     via `setImmediate` so the request handler returns before the network
 *     roundtrip starts.
 *  3. The delivery worker tries up to 3 times with `[1s, 5s, 30s]` backoff,
 *     updates the row with `status=SUCCESS|FAILED`, `statusCode`, `error`.
 *
 * Failures NEVER throw out of `dispatch()` — the caller's request must not
 * be coupled to a remote endpoint's availability.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
  ) {}

  static get knownEvents(): readonly string[] {
    return WEBHOOK_EVENTS;
  }

  // ─── CRUD ───────────────────────────────────────────────

  async list(workspaceId: string, userId: string) {
    await this.workspacesService.assertMember(workspaceId, userId);
    return this.prisma.webhook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: USER_SELECT_BASIC },
    });
  }

  async create(workspaceId: string, userId: string, dto: CreateWebhookDto) {
    await this.workspacesService.assertRole(workspaceId, userId, MANAGE_ROLES);
    this.assertKnownEvents(dto.events);

    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const hook = await this.prisma.webhook.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        url: dto.url,
        secret,
        events: dto.events,
        enabled: dto.enabled ?? true,
        createdById: userId,
      },
    });
    return { message: MSG.SUCCESS.WEBHOOK_CREATED, webhook: hook };
  }

  async update(
    workspaceId: string,
    id: string,
    userId: string,
    dto: UpdateWebhookDto,
  ) {
    await this.workspacesService.assertRole(workspaceId, userId, MANAGE_ROLES);
    const exists = await this.prisma.webhook.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.WEBHOOK_NOT_FOUND);
    if (dto.events) this.assertKnownEvents(dto.events);

    const hook = await this.prisma.webhook.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      },
    });
    return { message: MSG.SUCCESS.WEBHOOK_UPDATED, webhook: hook };
  }

  async remove(workspaceId: string, id: string, userId: string) {
    await this.workspacesService.assertRole(workspaceId, userId, MANAGE_ROLES);
    const exists = await this.prisma.webhook.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.WEBHOOK_NOT_FOUND);
    await this.prisma.webhook.delete({ where: { id } });
    return { message: MSG.SUCCESS.WEBHOOK_DELETED };
  }

  async testSend(workspaceId: string, id: string, userId: string) {
    await this.workspacesService.assertRole(workspaceId, userId, MANAGE_ROLES);
    const hook = await this.prisma.webhook.findFirst({
      where: { id, workspaceId },
    });
    if (!hook) throw new NotFoundException(MSG.ERROR.WEBHOOK_NOT_FOUND);
    this.scheduleDelivery(hook, 'webhook.test', {
      message: 'Test event from Jira clone',
      sentAt: new Date().toISOString(),
    });
    return { message: MSG.SUCCESS.WEBHOOK_TEST_SCHEDULED };
  }

  // ─── Hot-path API for trigger sites (issues/comments) ────

  /**
   * Fire-and-forget. Resolves enabled hooks subscribed to `eventType` and
   * schedules each delivery on `setImmediate` so the caller's request
   * returns immediately. NEVER throws.
   */
  dispatch(workspaceId: string, eventType: string, payload: unknown): void {
    if (!WebhooksService.knownEvents.includes(eventType)) return;
    void this.lookupAndDispatch(workspaceId, eventType, payload).catch(
      (err: unknown) =>
        this.logger.warn(
          `webhook dispatch lookup failed for ${eventType}: ${String(err)}`,
        ),
    );
  }

  // ─── Admin: cross-workspace delivery log ─────────────────

  async listDeliveries(query: {
    webhookId?: string;
    status?: 'PENDING' | 'SUCCESS' | 'FAILED';
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 50));
    const where: Prisma.WebhookDeliveryWhereInput = {};
    if (query.webhookId) where.webhookId = query.webhookId;
    if (query.status) where.status = query.status;

    const [total, data] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.count({ where }),
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          webhook: {
            select: { id: true, name: true, url: true, workspaceId: true },
          },
        },
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasMore: page * pageSize < total,
      nextCursor: null,
    };
  }

  async retryDelivery(deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery)
      throw new NotFoundException(MSG.ERROR.WEBHOOK_DELIVERY_NOT_FOUND);
    if (delivery.status === 'PENDING') {
      throw new ForbiddenException(MSG.ERROR.WEBHOOK_DELIVERY_STILL_PENDING);
    }
    // Schedule a fresh delivery using the original payload — preserves history
    // (we don't mutate the old row).
    this.scheduleDelivery(
      delivery.webhook,
      delivery.eventType,
      delivery.payload,
    );
    return { message: MSG.SUCCESS.WEBHOOK_RETRY_SCHEDULED };
  }

  // ─── Internals ──────────────────────────────────────────

  private assertKnownEvents(events: string[]) {
    const unknown = events.filter(
      (e) => !WebhooksService.knownEvents.includes(e),
    );
    if (unknown.length > 0) {
      throw new NotFoundException(
        `${MSG.ERROR.WEBHOOK_UNKNOWN_EVENT}: ${unknown.join(', ')}`,
      );
    }
  }

  private async lookupAndDispatch(
    workspaceId: string,
    eventType: string,
    payload: unknown,
  ) {
    const hooks = await this.prisma.webhook.findMany({
      where: {
        workspaceId,
        enabled: true,
        events: { has: eventType },
      },
    });
    for (const hook of hooks) {
      this.scheduleDelivery(hook, eventType, payload);
    }
  }

  private scheduleDelivery(
    hook: { id: string; url: string; secret: string },
    eventType: string,
    payload: unknown,
  ) {
    setImmediate(() => {
      void this.runDelivery(hook, eventType, payload);
    });
  }

  private async runDelivery(
    hook: { id: string; url: string; secret: string },
    eventType: string,
    payload: unknown,
  ) {
    // Persist a PENDING row so the admin log shows the attempt before the
    // first network try resolves.
    const delivery = await this.prisma.webhookDelivery
      .create({
        data: {
          webhookId: hook.id,
          eventType,
          payload: payload as Prisma.InputJsonValue,
          status: 'PENDING',
        },
        select: { id: true },
      })
      .catch(() => null);

    if (!delivery) {
      this.logger.warn(`failed to record pending delivery for hook ${hook.id}`);
      return;
    }

    const body = isSlackUrl(hook.url)
      ? toSlackPayload(eventType, payload)
      : { event: eventType, payload };
    const bodyStr = JSON.stringify(body);
    const signature = createHmac('sha256', hook.secret)
      .update(bodyStr)
      .digest('hex');

    let attempts = 0;
    let statusCode = 0;
    let error: string | null = null;

    for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
      attempts = i + 1;
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Event': eventType,
            'X-Webhook-Signature': `sha256=${signature}`,
            'X-Webhook-Delivery': delivery.id,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
        if (res.ok) {
          error = null;
          break;
        }
        // Non-2xx — capture body preview, treat as retryable for 5xx, fail
        // immediately for 4xx (client error, retrying won't help).
        const text = await res.text().catch(() => '');
        error = text.slice(0, MAX_BODY_PREVIEW) || `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500) break;
      } catch (err) {
        statusCode = 0;
        error = String(err).slice(0, MAX_BODY_PREVIEW);
      }
      if (i < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[i]);
      }
    }

    const success = statusCode >= 200 && statusCode < 300;
    await this.prisma.webhookDelivery
      .update({
        where: { id: delivery.id },
        data: {
          status: success ? 'SUCCESS' : 'FAILED',
          statusCode,
          error,
          attempts,
          deliveredAt: new Date(),
        },
      })
      .catch(() => null);
  }
}

function isSlackUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'hooks.slack.com';
  } catch {
    return false;
  }
}

/**
 * Format a generic event payload as Slack incoming-webhook attachments.
 * Slack rejects arbitrary JSON; only the documented `text` + `attachments`
 * shape renders. We pull a handful of conventional fields out of the
 * payload (key, summary, action, link) and degrade gracefully if absent.
 */
function toSlackPayload(eventType: string, payload: unknown): SlackishPayload {
  const p = payload as {
    issue?: { key?: string; summary?: string };
    comment?: { content?: string };
    author?: { name?: string; email?: string };
    actor?: { name?: string; email?: string };
    link?: string;
  };
  const issueLine = p.issue?.key
    ? `*${p.issue.key}*${p.issue.summary ? ` — ${p.issue.summary}` : ''}`
    : '';
  const actor = p.author?.name ?? p.actor?.name ?? p.author?.email ?? '';
  const action = eventType.replace(/^issue\.|^comment\./, '');

  const attachmentText = [
    actor ? `*${actor}*` : null,
    action,
    issueLine,
    p.link ? `<${p.link}|View>` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const color =
    eventType === 'issue.deleted'
      ? '#ef4444'
      : eventType === 'issue.created'
        ? '#3b82f6'
        : '#6b7280';

  return {
    text: `New event: ${eventType}`,
    attachments: [
      { color, text: attachmentText || JSON.stringify(payload).slice(0, 200) },
    ],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Suppress unused-import lint when sha helpers are only referenced inside
// this file via the createHmac/createHash calls above.
void createHash;
