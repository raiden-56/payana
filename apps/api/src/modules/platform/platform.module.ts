import { Global, Module } from '@nestjs/common';
import { SettingsService } from './application/settings.service.js';
import { AdminSettingsController, HealthController, PublicConfigController } from './presentation/platform.controllers.js';

/** Health, public configuration, editable settings and the audit-log reader. */
@Global()
@Module({
  controllers: [HealthController, PublicConfigController, AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class PlatformModule {}
