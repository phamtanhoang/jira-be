import { Injectable } from '@nestjs/common';
import { LogLevel, Prisma } from '@prisma/client';
import { LogsService } from './logs.service';

/**
 * Centralized, typed event vocabulary. Adding an event = ADD a constant
 * here, NOT a free-form string at the call site. This is what keeps the
 * log queryable + the admin UI's filter list finite + dashboards stable.
 *
 * Convention: `<domain>.<action>.<outcome>` (lowercase, dot-separated).
 *   - domain  : auth, authz, quota, ratelimit, perf, error, attachment, ...
 *   - action  : login, signup, denied, exceeded, slow_request, ...
 *   - outcome : success | failed | <omitted when self-evident>
 */
export const EVENTS = {
  // Authentication flow milestones — security-relevant, always logged.
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILED: 'auth.login.failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_SIGNUP: 'auth.signup',
  AUTH_EMAIL_VERIFIED: 'auth.email.verified',
  AUTH_PASSWORD_CHANGED: 'auth.password.changed',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password.reset.requested',
  AUTH_OAUTH_LINKED: 'auth.oauth.linked',
  AUTH_OAUTH_UNLINKED: 'auth.oauth.unlinked',

  // Authorization — every 403 is interesting (denied access patterns).
  AUTHZ_DENIED: 'authz.denied',

  // Rate-limit + quota — operational signal that limits are biting.
  RATELIMIT_HIT: 'ratelimit.hit',
  QUOTA_EXCEEDED: 'quota.exceeded',

  // Performance — slow request, slow query.
  PERF_SLOW_REQUEST: 'perf.slow_request',

  // Errors — 5xx + uncaught. Every occurrence logged (low volume).
  ERROR_5XX: 'error.5xx',
  ERROR_UNCAUGHT: 'error.uncaught',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export interface EventLogParams {
  level?: LogLevel;
  userId?: string | null;
  userEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  method?: string;
  url?: string;
  route?: string | null;
  statusCode?: number;
  durationMs?: number;
  metadata?: Prisma.InputJsonValue;
  errorMessage?: string | null;
  errorStack?: string | null;
  sentryEventId?: string | null;
  /** Set only for auth/security events that legitimately need the
   *  inbound shape (e.g. login attempt — sanitized email but no password). */
  requestBody?: Prisma.InputJsonValue;
}

/**
 * Thin typed wrapper over `LogsService.enqueue`. Use this from anywhere in
 * the app to record a meaningful event — service methods, interceptors,
 * cron jobs.
 *
 * Why a separate service: the raw `LogsService` deals in row shape; this
 * one deals in event names + structured metadata. Keeps call sites
 * declarative ("an auth.login.success happened with these properties")
 * instead of plumbing every `level/source/method/url/...` by hand.
 */
@Injectable()
export class EventLoggerService {
  constructor(private logs: LogsService) {}

  /**
   * Record an event. Fire-and-forget — never throws, never blocks the
   * caller. Honors the LoggingConfig kill switch under the hood.
   */
  log(event: EventName, params: EventLogParams = {}): void {
    this.logs.enqueue({
      event,
      level: params.level ?? defaultLevelFor(event),
      source: 'backend',
      method: params.method ?? '-',
      url: params.url ?? event,
      route: params.route ?? null,
      statusCode: params.statusCode ?? null,
      durationMs: params.durationMs ?? null,
      userId: params.userId ?? null,
      userEmail: params.userEmail ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata,
      requestBody: params.requestBody,
      errorMessage: params.errorMessage ?? null,
      errorStack: params.errorStack ?? null,
      sentryEventId: params.sentryEventId ?? null,
    });
  }
}

function defaultLevelFor(event: EventName): LogLevel {
  if (event === EVENTS.ERROR_5XX || event === EVENTS.ERROR_UNCAUGHT) {
    return LogLevel.ERROR;
  }
  if (
    event === EVENTS.AUTH_LOGIN_FAILED ||
    event === EVENTS.AUTHZ_DENIED ||
    event === EVENTS.RATELIMIT_HIT ||
    event === EVENTS.QUOTA_EXCEEDED ||
    event === EVENTS.PERF_SLOW_REQUEST
  ) {
    return LogLevel.WARN;
  }
  return LogLevel.INFO;
}
