import { Module } from '@nestjs/common';
import {
  AttachmentsIssueController,
  AttachmentsManageController,
} from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  controllers: [AttachmentsIssueController, AttachmentsManageController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
