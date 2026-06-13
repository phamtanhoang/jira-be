import { Controller, Param, Sse } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { RealtimeEventsService } from './events.service';
import type { RealtimeEvent } from './events.types';

/**
 * Server-Sent Events endpoints — push cache-invalidation hints to open
 * tabs. Auth comes from the standard JWT cookie/bearer middleware (SSE
 * can't add custom Authorization headers, but `withCredentials: true`
 * on EventSource sends our httpOnly cookie).
 *
 * Each subscriber filters the server-side firehose down to events that
 * affect its own page (project board, issue detail, dashboard). The FE
 * receives the event payload and invalidates the matching React Query
 * key — no business data crosses the wire, just IDs.
 */
@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: RealtimeEventsService) {}

  /**
   * Per-user channel — events explicitly addressed to this user
   * (notifications, watched-issue mentions). The producer MUST set
   * `recipientId` on the event for it to land here; project-scoped
   * events stay on `/events/project/:id`.
   *
   * Previous design filtered by `excludeActorId` only — that leaked
   * every other user's events to every open `/events/me` connection.
   */
  @Sse('me')
  @ApiOperation({ summary: 'SSE — events addressed to the current user' })
  me(@CurrentUser() user: AuthUser): Observable<{ data: RealtimeEvent }> {
    return this.events
      .stream({ recipientId: user.id })
      .pipe(map((event) => ({ data: event })));
  }

  /**
   * Per-project channel — board, backlog, sprint dashboards subscribe to
   * this so any change inside the project (drag, edit, create) refreshes
   * for every viewer.
   */
  @Sse('project/:projectId')
  @ApiOperation({ summary: 'SSE — events scoped to one project' })
  project(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ): Observable<{ data: RealtimeEvent }> {
    return this.events
      .stream({ projectId, excludeActorId: user.id })
      .pipe(map((event) => ({ data: event })));
  }

  /**
   * Per-issue channel — issue detail page subscribes for this issue's
   * field changes, comments, attachments. Highest-fidelity stream.
   */
  @Sse('issue/:issueId')
  @ApiOperation({ summary: 'SSE — events scoped to one issue' })
  issue(
    @Param('issueId') issueId: string,
    @CurrentUser() user: AuthUser,
  ): Observable<{ data: RealtimeEvent }> {
    return this.events
      .stream({ issueId, excludeActorId: user.id })
      .pipe(map((event) => ({ data: event })));
  }
}
