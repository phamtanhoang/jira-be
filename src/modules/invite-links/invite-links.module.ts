import { Module } from '@nestjs/common';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { InviteLinksController } from './invite-links.controller';
import { InviteLinksService } from './invite-links.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [InviteLinksController],
  providers: [InviteLinksService],
})
export class InviteLinksModule {}
