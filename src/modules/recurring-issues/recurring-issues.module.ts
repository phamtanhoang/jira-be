import { Module } from '@nestjs/common';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { RecurringIssuesController } from './recurring-issues.controller';
import { RecurringIssuesService } from './recurring-issues.service';

@Module({
  imports: [ProjectsModule],
  controllers: [RecurringIssuesController],
  providers: [RecurringIssuesService],
})
export class RecurringIssuesModule {}
