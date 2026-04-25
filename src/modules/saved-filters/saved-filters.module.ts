import { Module } from '@nestjs/common';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import { SavedFiltersController } from './saved-filters.controller';
import { SavedFiltersService } from './saved-filters.service';

@Module({
  imports: [ProjectsModule, WorkspacesModule],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
})
export class SavedFiltersModule {}
