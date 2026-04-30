import { Module } from '@nestjs/common';
import { BoardsModule } from '@/modules/boards/boards.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

// AdminAuditService comes from the @Global AdminAuditModule registered in AppModule.

@Module({
  imports: [WorkspacesModule, BoardsModule],
  controllers: [ProjectsController],
  // Repository stays internal to the module; only the service is exported.
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
export class ProjectsModule {}
