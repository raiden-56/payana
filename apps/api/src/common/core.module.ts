import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/env.js';
import { AuditService } from './audit/audit.service.js';
import { AccessTokenService } from './auth/access-token.service.js';
import { dataSourceOptions } from './db/data-source.js';
import { Db } from './db/db.service.js';
import { IdempotencyInterceptor } from './idempotency/idempotency.js';
import { RedisThrottlerStorage } from './http/throttler-storage.js';
import { OutboxService } from './outbox/outbox.service.js';
import { RedisModule } from './redis/redis.module.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

/**
 * The shared kernel every feature module may depend on: configuration,
 * database access, Redis, access tokens, audit trail, outbox, idempotency.
 * It contains no business rules.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        ...dataSourceOptions(config.databaseUrl, config.databaseSsl),
        // Retrying forever hides a bad DATABASE_URL; fail fast instead.
        retryAttempts: config.isProduction ? 5 : 1,
        retryDelay: 1000,
      }),
    }),
  ],
  providers: [Db, AccessTokenService, AuditService, OutboxService, IdempotencyInterceptor, RedisThrottlerStorage],
  exports: [Db, AccessTokenService, AuditService, OutboxService, IdempotencyInterceptor, RedisThrottlerStorage, RedisModule],
})
export class CoreModule {}
