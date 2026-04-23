import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '@/core/database/prisma.module';
import { AllExceptionsFilter } from '@/core/filters/http-exception.filter';
import { JwtAuthGuard, RolesGuard } from '@/core/guards';
import {
  RequestLoggerInterceptor,
  TimezoneInterceptor,
} from '@/core/interceptors';
import { SentryService } from '@/core/services/sentry.service';
import { AttachmentsModule } from '@/modules/attachments/attachments.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BoardsModule } from '@/modules/boards/boards.module';
import { CommentsModule } from '@/modules/comments/comments.module';
import { DebugModule } from '@/modules/debug/debug.module';
import { IssuesModule } from '@/modules/issues/issues.module';
import { LabelsModule } from '@/modules/labels/labels.module';
import { LogsModule } from '@/modules/logs/logs.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { SprintsModule } from '@/modules/sprints/sprints.module';
import { UsersModule } from '@/modules/users/users.module';
import { WorklogsModule } from '@/modules/worklogs/worklogs.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    ScheduleModule.forRoot(),
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
    WorklogsModule,
    AttachmentsModule,
    UsersModule,
    DebugModule,
  ],
  providers: [
    SentryService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimezoneInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
