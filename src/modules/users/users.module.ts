import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { UserProfileController } from './profile.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, AdminController, UserProfileController],
  providers: [UsersService, AdminService],
  // Exported so HealthModule can reuse AdminService.getPublicHealth().
  exports: [AdminService],
})
export class UsersModule {}
