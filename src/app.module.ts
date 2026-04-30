import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppCacheModule } from '@/core/cache/cache.module';
import { PrismaModule } from '@/core/database/prisma.module';
import { AllExceptionsFilter } from '@/core/filters/http-exception.filter';
import {
  JwtAuthGuard,
  OverridableThrottlerGuard,
  RolesGuard,
} from '@/core/guards';
import {
  RequestLoggerInterceptor,
  TimezoneInterceptor,
} from '@/core/interceptors';
import { SentryService } from '@/core/services/sentry.service';
import { AdminAuditModule } from '@/modules/admin-audit/admin-audit.module';
import { AttachmentsModule } from '@/modules/attachments/attachments.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BoardsModule } from '@/modules/boards/boards.module';
import { CommentsModule } from '@/modules/comments/comments.module';
import { CustomFieldsModule } from '@/modules/custom-fields/custom-fields.module';
import { DebugModule } from '@/modules/debug/debug.module';
import { FeatureFlagsModule } from '@/modules/feature-flags/feature-flags.module';
import { GdprModule } from '@/modules/gdpr/gdpr.module';
import { HealthModule } from '@/modules/health/health.module';
import { InviteLinksModule } from '@/modules/invite-links/invite-links.module';
import { IssueTemplatesModule } from '@/modules/issue-templates/issue-templates.module';
import { IssuesModule } from '@/modules/issues/issues.module';
import { LabelsModule } from '@/modules/labels/labels.module';
import { LogsModule } from '@/modules/logs/logs.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { PatModule } from '@/modules/personal-access-tokens/pat.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { PublicModule } from '@/modules/public/public.module';
import { PushModule } from '@/modules/push/push.module';
import { RecurringIssuesModule } from '@/modules/recurring-issues/recurring-issues.module';
import { SavedFiltersModule } from '@/modules/saved-filters/saved-filters.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { SprintsModule } from '@/modules/sprints/sprints.module';
import { ThrottleOverridesModule } from '@/modules/throttle-overrides/throttle-overrides.module';
import { UsersModule } from '@/modules/users/users.module';
import { WebhooksModule } from '@/modules/webhooks/webhooks.module';
import { WorklogsModule } from '@/modules/worklogs/worklogs.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';

@Module({
  imports: [
    // Global default: 60 req/min (1 req/s average). Low enough to catch
    // abusive bots, high enough that normal authenticated flows (bulk
    // edits, dragging a bunch of issues, opening/closing modals) don't
    // trip it. Endpoints that need stricter limits (auth, upload) apply
    // their own @Throttle() decorator per-route.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    ScheduleModule.forRoot(),
    AppCacheModule,
    PrismaModule,
    LogsModule,
    AuthModule,
    SettingsModule,
    WorkspacesModule,
    ProjectsModule,
    BoardsModule,
    SprintsModule,
    IssuesModule,
    LabelsModule,
    CommentsModule,
    CustomFieldsModule,
    RecurringIssuesModule,
    PushModule,
    WorklogsModule,
    AttachmentsModule,
    UsersModule,
    FeatureFlagsModule,
    GdprModule,
    HealthModule,
    AdminAuditModule,
    NotificationsModule,
    PatModule,
    SavedFiltersModule,
    IssueTemplatesModule,
    InviteLinksModule,
    PublicModule,
    ThrottleOverridesModule,
    WebhooksModule,
    DebugModule,
  ],
  providers: [
    SentryService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: OverridableThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimezoneInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
