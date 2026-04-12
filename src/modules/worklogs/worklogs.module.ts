import { Module } from '@nestjs/common';
import { WorklogsIssueController, WorklogsManageController } from './worklogs.controller';
import { WorklogsService } from './worklogs.service';

@Module({
  controllers: [WorklogsIssueController, WorklogsManageController],
  providers: [WorklogsService],
})
export class WorklogsModule {}
