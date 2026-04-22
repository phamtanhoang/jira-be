import { Module } from '@nestjs/common';
import { BoardsModule } from '@/modules/boards/boards.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [WorkspacesModule, BoardsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
