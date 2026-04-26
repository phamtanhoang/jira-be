import { Global, Module } from '@nestjs/common';
import { ThrottleOverridesController } from './throttle-overrides.controller';
import { ThrottleOverridesService } from './throttle-overrides.service';

// @Global because the custom ThrottlerGuard (registered in AppModule) needs
// to inject ThrottleOverridesService without re-importing the module on the
// guard side.
@Global()
@Module({
  controllers: [ThrottleOverridesController],
  providers: [ThrottleOverridesService],
  exports: [ThrottleOverridesService],
})
export class ThrottleOverridesModule {}
