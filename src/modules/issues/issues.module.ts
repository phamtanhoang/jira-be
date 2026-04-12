import { Module } from '@nestjs/common';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
