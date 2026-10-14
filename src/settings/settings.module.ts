import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { DrizzleSettingsRepository } from './settings.repository';
import { SETTINGS_REPOSITORY } from './settings.types';

@Global()
@Module({
  providers: [SettingsService, { provide: SETTINGS_REPOSITORY, useClass: DrizzleSettingsRepository }],
  exports: [SettingsService],
})
export class SettingsModule {}
