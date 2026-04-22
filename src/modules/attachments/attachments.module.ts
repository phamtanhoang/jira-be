import { Module } from '@nestjs/common';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import {
  AttachmentsIssueController,
  AttachmentsManageController,
} from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [AttachmentsIssueController, AttachmentsManageController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
