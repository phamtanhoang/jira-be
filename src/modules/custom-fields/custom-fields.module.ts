import { Global, Module } from '@nestjs/common';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';

// @Global so IssuesService can inject CustomFieldsService for the
// per-issue value upsert path without re-importing the module.
@Global()
@Module({
  imports: [ProjectsModule],
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
