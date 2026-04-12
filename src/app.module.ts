import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '@/core/database/prisma.module';
import { JwtAuthGuard, RolesGuard } from '@/core/guards';
import { TimezoneInterceptor } from '@/core/interceptors';
import { AuthModule } from '@/modules/auth/auth.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { BoardsModule } from '@/modules/boards/boards.module';
import { SprintsModule } from '@/modules/sprints/sprints.module';
import { IssuesModule } from '@/modules/issues/issues.module';
import { LabelsModule } from '@/modules/labels/labels.module';
import { CommentsModule } from '@/modules/comments/comments.module';
import { WorklogsModule } from '@/modules/worklogs/worklogs.module';

@Module({
  imports: [
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
      provide: APP_INTERCEPTOR,
      useClass: TimezoneInterceptor,
    },
  ],
})
export class AppModule {}
