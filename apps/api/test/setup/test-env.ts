import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Environment for the end-to-end suite. Works with no local files at all
 * (CI passes DATABASE_URL / REDIS_URL), and with a developer's `.env`, from
 * which it borrows only the host and port of the local infrastructure.
 *
 * The suite always runs against its OWN database (`payana_test`) and its own
 * Redis logical database, so it never touches development data.
 */
export function applyTestEnv(): void {
  const envFile = resolve(process.cwd(), '.env');
  const preset = { db: process.env.TEST_DATABASE_URL, redis: process.env.TEST_REDIS_URL };
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* an unreadable .env just means defaults are used */
    }
  }
  const devDb = process.env.DATABASE_URL ?? 'postgres://payana:payana_dev_only@localhost:5439/payana';
  const devRedis = process.env.REDIS_URL ?? 'redis://localhost:6380';

  const testDb = new URL(preset.db ?? devDb);
  if (!preset.db) testDb.pathname = '/payana_test';
  const testRedis = new URL(preset.redis ?? devRedis);
  if (!preset.redis) testRedis.pathname = '/1';

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: testDb.toString(),
    REDIS_URL: testRedis.toString(),
    LOG_LEVEL: 'silent',
    JOBS_ENABLED: 'false',
    DEMO_POSITION_HEARTBEAT: 'false',
    SWAGGER_ENABLED: 'false',
    SMS_DRIVER: 'dev',
    PAYMENT_PROVIDER: 'manual',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: '.storage-test',
    PUBLIC_API_URL: '',
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: 'http://localhost:4200',
    // The coarse per-IP request throttle is off so the suite (one client address) is not
    // throttled by its own volume. The limits under test - OTP attempts, resend cool-down,
    // staff lockout - are separate mechanisms and stay fully active.
    THROTTLE_DISABLED: 'true',
    OTP_MAX_REQUESTS_PER_IP_PER_HOUR: '100000',
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'test-only-access-secret-0123456789abcdef0123',
    SIGNING_SECRET: process.env.SIGNING_SECRET ?? 'test-only-signing-secret-0123456789abcdef0123',
    DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? 'ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE=',
  });
}
