import { Module } from '@nestjs/common';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { IssuesController } from './issues.controller';
import { IssuesRepository } from './issues.repository';
import { IssuesService } from './issues.service';
import { IssuesActivityService } from './services/issues-activity.service';
import { IssuesBulkService } from './services/issues-bulk.service';
import { IssuesExportService } from './services/issues-export.service';
import { IssuesLabelsService } from './services/issues-labels.service';
import { IssuesLinksService } from './services/issues-links.service';
import { IssuesShareService } from './services/issues-share.service';
import { IssuesWatchersService } from './services/issues-watchers.service';

@Module({
  imports: [WorkspacesModule, ProjectsModule],
  controllers: [IssuesController],
  providers: [
    IssuesService,
    IssuesRepository,
    IssuesActivityService,
    IssuesBulkService,
    IssuesExportService,
    IssuesLabelsService,
    IssuesLinksService,
    IssuesShareService,
    IssuesWatchersService,
  ],
  // Only the façade is exposed externally — sub-services + repository stay internal.
  exports: [IssuesService],
})
export class IssuesModule {}
