import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { HealthController } from './health.controller';

@Module({
  // AdminService lives in UsersModule and exposes getPublicHealth().
  imports: [UsersModule],
  controllers: [HealthController],
})
export class HealthModule {}
