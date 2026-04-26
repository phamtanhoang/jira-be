import { Module } from '@nestjs/common';
import { IssuesModule } from '@/modules/issues/issues.module';
import { PublicController } from './public.controller';

// `public/*` routes that opt out of JwtAuthGuard via @Public(). The actual
// service logic lives in IssuesService — this module is a thin auth-less
// wrapper.
@Module({
  imports: [IssuesModule],
  controllers: [PublicController],
})
export class PublicModule {}
