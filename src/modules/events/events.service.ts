import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, Subject, filter, map } from 'rxjs';
import type { RealtimeEvent } from './events.types';

/**
 * In-process pub/sub for realtime cache-invalidation events.
 *
 * Producers (domain services) call `emit()` — fire-and-forget, never
 * throws. Consumers (SSE controller) subscribe via `stream()` with a
 * channel filter to receive only relevant events.
 *
 * Single-process design: events stay in memory of the current BE
 * instance. With multi-replica deploys later, swap the Subject for a
 * Redis pub/sub adapter — the interface here is stable.
 */
@Injectable()
export class RealtimeEventsService {
  private readonly logger = new Logger(RealtimeEventsService.name);
  private readonly subject = new Subject<RealtimeEvent>();

  constructor(private readonly emitter: EventEmitter2) {
    // Mirror NestJS EventEmitter2 traffic into the rxjs Subject so we
    // can use rxjs operators (filter/map/throttle) on the consumer side.
    // Services can emit via EventEmitter2 OR call `emit()` directly.
    this.emitter.onAny((eventName, payload) => {
      // We only relay events that start with `realtime.` — keeps the
      // pipeline focused and lets other modules use EventEmitter2 for
      // unrelated purposes without leaking onto SSE channels.
      if (typeof eventName !== 'string' || !eventName.startsWith('realtime.')) {
        return;
      }
      if (this.isRealtimeEvent(payload)) {
        this.subject.next(payload);
      }
    });
  }

  /** Fire-and-forget. Swallows errors so a failed emit never breaks the
   *  caller's request (matches webhooks + notifications semantics). */
  emit(event: RealtimeEvent): void {
    try {
      // Two paths into the same stream — keeps domain services flexible.
      this.subject.next(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`realtime emit failed: ${msg}`);
    }
  }

  /**
   * Stream of events filtered down to a specific channel scope.
   *
   * - `{ recipientId: 'x' }` — events explicitly addressed to user x
   *   (notifications, watched-issue mentions). Producers MUST set
   *   `recipientId` on the event for `/events/me` to receive it.
   * - `{ projectId: 'p' }` — every event whose payload mentions projectId p.
   * - `{ issueId: 'i' }` — every event for that specific issue.
   * - `{}` — global firehose (admin-only; not exposed).
   *
   * `excludeActorId` is applied last so the originating tab doesn't
   * pointlessly invalidate its own cache after a mutation.
   */
  stream(opts: {
    recipientId?: string;
    workspaceId?: string;
    projectId?: string;
    issueId?: string;
    excludeActorId?: string;
  }): Observable<RealtimeEvent> {
    return this.subject.asObservable().pipe(
      filter((ev) => {
        if (opts.recipientId && ev.recipientId !== opts.recipientId) {
          return false;
        }
        if (opts.workspaceId && ev.workspaceId !== opts.workspaceId) {
          return false;
        }
        if (opts.projectId && ev.projectId !== opts.projectId) return false;
        if (opts.issueId && ev.issueId !== opts.issueId) return false;
        if (opts.excludeActorId && ev.actorId === opts.excludeActorId) {
          return false;
        }
        return true;
      }),
      map((ev) => ev),
    );
  }

  private isRealtimeEvent(v: unknown): v is RealtimeEvent {
    return (
      typeof v === 'object' &&
      v !== null &&
      'type' in v &&
      typeof (v as { type: unknown }).type === 'string'
    );
  }
}
