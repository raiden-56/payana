import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';
import { OBJECT_STORAGE } from './application/storage.port.js';
import { UploadsService } from './application/uploads.service.js';
import { LocalDiskStorage, S3Storage } from './infrastructure/storage.adapters.js';
import { UploadsController } from './presentation/uploads.controller.js';

/** File uploads behind a storage port: local disk in development, S3-compatible in production. */
@Global()
@Module({
  controllers: [UploadsController],
  providers: [
    UploadsService,
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.storage.driver === 's3' ? new S3Storage(config) : new LocalDiskStorage(config),
    },
  ],
  exports: [UploadsService],
})
export class StorageModule {}
