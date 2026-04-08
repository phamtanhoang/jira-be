import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '@/core/database/prisma.module';
import { JwtAuthGuard, RolesGuard } from '@/core/guards';
import { TimezoneInterceptor } from '@/core/interceptors';
import { AuthModule } from '@/modules/auth/auth.module';
import { SettingsModule } from '@/modules/settings/settings.module';

@Module({
  imports: [PrismaModule, AuthModule, SettingsModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TimezoneInterceptor,
    },
  ],
})
export class AppModule {}
