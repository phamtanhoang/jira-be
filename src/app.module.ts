import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './core/database/prisma.module.js';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';

@Module({
  imports: [PrismaModule, AuthModule, SettingsModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
