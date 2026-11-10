import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { REQUEST_ID_HEADER } from '@payana/contracts';
import { LoggerModule } from 'nestjs-pino';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from './common/auth/guards.js';
import { CoreModule } from './common/core.module.js';
import { RedisThrottlerStorage } from './common/http/throttler-storage.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { BookingsModule } from './modules/bookings/bookings.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { EngagementModule } from './modules/engagement/engagement.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { MarketplaceModule } from './modules/marketplace/marketplace.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { PromotionsModule } from './modules/promotions/promotions.module.js';
import { StorageModule } from './modules/storage/storage.module.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

@Module({
  imports: [
    CoreModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const incoming = req.headers[REQUEST_ID_HEADER];
            const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          // Never write credentials, cookies or one-time codes to the logs.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body.code',
              'req.body.password',
              'req.body.refreshToken',
            ],
            censor: '[redacted]',
          },
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').includes('/health/') },
          transport:
            config.nodeEnv === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, RedisThrottlerStorage],
      useFactory: (config: AppConfig, storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: config.throttle.ttlSeconds * 1000, limit: config.throttle.limit }],
        storage,
        // Only ever true under the automated test suite (the config loader refuses it in production).
        skipIf: () => config.throttle.disabled,
      }),
    }),
    EventEmitterModule.forRoot({ wildcard: false, verboseMemoryLeak: false }),
    ScheduleModule.forRoot(),
    PlatformModule,
    StorageModule,
    IdentityModule,
    CatalogModule,
    MarketplaceModule,
    BillingModule,
    PromotionsModule,
    BookingsModule,
    EngagementModule,
    AdminModule,
  ],
  providers: [
    // Order matters: rate limit, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
