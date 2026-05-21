import { Module } from '@nestjs/common';
import { SettingsModule } from '@/modules/settings/settings.module';
import { AttachmentsLargeController } from './attachments-large.controller';
import { AttachmentsLargeService } from './attachments-large.service';

@Module({
  imports: [SettingsModule],
  controllers: [AttachmentsLargeController],
  providers: [AttachmentsLargeService],
})
export class AttachmentsLargeModule {}
