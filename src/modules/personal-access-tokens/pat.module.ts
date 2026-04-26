import { Global, Module } from '@nestjs/common';
import { PatController } from './pat.controller';
import { PatService } from './pat.service';

// @Global so JwtAuthGuard can resolve PatService lazily without a circular
// import chain (auth → guard → pat → auth).
@Global()
@Module({
  controllers: [PatController],
  providers: [PatService],
  exports: [PatService],
})
export class PatModule {}
