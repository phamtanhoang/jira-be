import { Module } from '@nestjs/common';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { IssueTemplatesController } from './issue-templates.controller';
import { IssueTemplatesService } from './issue-templates.service';

@Module({
  imports: [ProjectsModule, WorkspacesModule],
  controllers: [IssueTemplatesController],
  providers: [IssueTemplatesService],
})
export class IssueTemplatesModule {}
