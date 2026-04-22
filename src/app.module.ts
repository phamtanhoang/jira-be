import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from '@/core/database/prisma.module';
import { JwtAuthGuard, RolesGuard } from '@/core/guards';
import { TimezoneInterceptor } from '@/core/interceptors';
import { AttachmentsModule } from '@/modules/attachments/attachments.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BoardsModule } from '@/modules/boards/boards.module';
import { CommentsModule } from '@/modules/comments/comments.module';
import { IssuesModule } from '@/modules/issues/issues.module';
import { LabelsModule } from '@/modules/labels/labels.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { SprintsModule } from '@/modules/sprints/sprints.module';
import { WorklogsModule } from '@/modules/worklogs/worklogs.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TimezoneInterceptor,
    },
  ],
})
export class AppModule {}
