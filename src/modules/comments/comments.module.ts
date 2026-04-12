import { Module } from '@nestjs/common';
import { CommentsController, CommentsManageController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  controllers: [CommentsController, CommentsManageController],
  providers: [CommentsService],
})
export class CommentsModule {}
