import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Environment-based configuration. Every value the API needs comes from
 * process.env (a local `.env` file is loaded in development and test only).
 * Parsing is strict: a missing or malformed value stops the process at boot
 * rather than surfacing later as a runtime fault.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  appName: string;
  port: number;
  logLevel: string;
  /** Absolute origin used when a response must contain an absolute URL. Empty = relative URLs. */
  publicApiUrl: string;
  corsOrigins: string[];
  /** Number of reverse proxies in front of the API (for the real client IP). */
  trustProxy: number;
  databaseUrl: string;
  databaseSsl: boolean;
  redisUrl: string;
  auth: {
    accessTokenSecret: Uint8Array;
    accessTokenTtlSeconds: number;
    refreshTokenTtlDays: number;
    cookieSecure: boolean;
    /** Require TOTP for every administrator role, not only super_admin. */
    enforceMfaForAllAdmins: boolean;
    /** HMAC key for signed URLs and short-lived MFA tokens. */
    signingSecret: string;
    /** 32-byte key for AES-256-GCM encryption of MFA secrets and document numbers. */
    dataEncryptionKey: Buffer;
  };
  sms: { driver: 'dev' | 'provider' };
  otp: { maxRequestsPerPhonePerHour: number; maxRequestsPerIpPerHour: number };
  payments: { provider: 'manual' | 'razorpay'; featuredPricePerDayMinor: number };
  storage: {
    driver: 'local' | 's3';
    localDir: string;
    s3: {
      bucket: string;
      region: string;
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    };
  };
  throttle: { ttlSeconds: number; limit: number; disabled: boolean };
  swaggerEnabled: boolean;
  jobsEnabled: boolean;
  /** Development only: keeps the seeded demo drivers' positions fresh so the demo does not go stale. */
  demoPositionHeartbeat: boolean;
  seed: { adminPassword: string; adminTotpSecret: string };
}

class ConfigError extends Error {}

function loadDotEnv(): void {
  if (process.env.NODE_ENV === 'production') return;
  const file = resolve(process.cwd(), process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new ConfigError(`Missing required environment variable ${name}`);
  }
  return v;
}

function int(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new ConfigError(`${name} must be an integer >= ${min}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ConfigError(`${name} must be true or false`);
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!allowed.includes(raw as T)) {
    throw new ConfigError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return raw as T;
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  const nodeEnv = oneOf('NODE_ENV', ['development', 'test', 'production'] as const, 'development');
  const isProduction = nodeEnv === 'production';

  const accessSecret = str('JWT_ACCESS_SECRET');
  if (accessSecret.length < 32) throw new ConfigError('JWT_ACCESS_SECRET must be at least 32 characters');
  const signingSecret = str('SIGNING_SECRET');
  if (signingSecret.length < 32) throw new ConfigError('SIGNING_SECRET must be at least 32 characters');
  const dataKey = Buffer.from(str('DATA_ENCRYPTION_KEY'), 'base64');
  if (dataKey.length !== 32) {
    throw new ConfigError('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
  }

  const smsDriver = oneOf('SMS_DRIVER', ['dev', 'provider'] as const, isProduction ? 'provider' : 'dev');
  if (isProduction && smsDriver === 'dev') {
    throw new ConfigError(
      'SMS_DRIVER=dev echoes one-time codes in API responses and must never run in production',
    );
  }

  const storageDriver = oneOf('STORAGE_DRIVER', ['local', 's3'] as const, isProduction ? 's3' : 'local');

  const config: AppConfig = {
    nodeEnv,
    isProduction,
    appName: str('APP_NAME', 'Payana'),
    port: int('PORT', 3000, 1),
    logLevel: str('LOG_LEVEL', nodeEnv === 'test' ? 'silent' : 'info'),
    publicApiUrl: str('PUBLIC_API_URL', '').replace(/\/$/, ''),
    corsOrigins: str('CORS_ORIGINS', 'http://localhost:4200')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: int('TRUST_PROXY', isProduction ? 1 : 0),
    databaseUrl: str('DATABASE_URL'),
    databaseSsl: bool('DATABASE_SSL', false),
    redisUrl: str('REDIS_URL'),
    auth: {
      accessTokenSecret: new TextEncoder().encode(accessSecret),
      accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 900, 60),
      refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30, 1),
      cookieSecure: bool('COOKIE_SECURE', isProduction),
      enforceMfaForAllAdmins: bool('ADMIN_MFA_ENFORCE_ALL', false),
      signingSecret,
      dataEncryptionKey: dataKey,
    },
    sms: { driver: smsDriver },
    otp: {
      maxRequestsPerPhonePerHour: int('OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR', 6, 1),
      maxRequestsPerIpPerHour: int('OTP_MAX_REQUESTS_PER_IP_PER_HOUR', 30, 1),
    },
    payments: {
      provider: oneOf('PAYMENT_PROVIDER', ['manual', 'razorpay'] as const, 'manual'),
      featuredPricePerDayMinor: int('FEATURED_PRICE_PER_DAY_MINOR', 4900, 0),
    },
    storage: {
      driver: storageDriver,
      localDir: resolve(process.cwd(), str('STORAGE_LOCAL_DIR', '.storage')),
      s3: {
        bucket: str('S3_BUCKET', ''),
        region: str('S3_REGION', 'ap-south-1'),
        endpoint: str('S3_ENDPOINT', ''),
        accessKeyId: str('S3_ACCESS_KEY_ID', ''),
        secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
        forcePathStyle: bool('S3_FORCE_PATH_STYLE', false),
      },
    },
    throttle: {
      ttlSeconds: int('THROTTLE_TTL_SECONDS', 60, 1),
      limit: int('THROTTLE_LIMIT', 240, 1),
      disabled: bool('THROTTLE_DISABLED', false),
    },
    swaggerEnabled: bool('SWAGGER_ENABLED', !isProduction),
    jobsEnabled: bool('JOBS_ENABLED', nodeEnv !== 'test'),
    demoPositionHeartbeat: !isProduction && bool('DEMO_POSITION_HEARTBEAT', false),
    seed: {
      adminPassword: str('SEED_ADMIN_PASSWORD', ''),
      adminTotpSecret: str('SEED_ADMIN_TOTP_SECRET', ''),
    },
  };

  if (config.storage.driver === 's3' && !config.storage.s3.bucket) {
    throw new ConfigError('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }
  if (isProduction && config.throttle.disabled) {
    throw new ConfigError('THROTTLE_DISABLED exists for the automated test suite only and may not be set in production');
  }
  if (isProduction && config.corsOrigins.some((o) => o === '*')) {
    throw new ConfigError('CORS_ORIGINS may not contain * in production');
  }
  return config;
}

/** DI token for the parsed configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
