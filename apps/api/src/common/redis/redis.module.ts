import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/env.js';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/** Fixed-window counter in Redis: the building block for OTP and login limits. */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts a hit. `allowed` is false once the window holds more than `limit` hits. */
  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number; hits: number }> {
    const k = `rl:${key}`;
    const hits = await this.redis.incr(k);
    if (hits === 1) await this.redis.expire(k, windowSeconds);
    let ttl = await this.redis.ttl(k);
    if (ttl < 0) {
      await this.redis.expire(k, windowSeconds);
      ttl = windowSeconds;
    }
    return { allowed: hits <= limit, retryAfterSeconds: ttl, hits };
  }

  async peek(key: string): Promise<{ hits: number; ttl: number }> {
    const k = `rl:${key}`;
    const [hits, ttl] = await Promise.all([this.redis.get(k), this.redis.ttl(k)]);
    return { hits: Number(hits ?? 0), ttl: Math.max(ttl, 0) };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}

/** Runs a job on one instance at a time using a short-lived Redis lock. */
@Injectable()
export class JobLock {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async runExclusive(name: string, ttlSeconds: number, fn: () => Promise<void>): Promise<boolean> {
    const key = `job:${name}`;
    const acquired = await this.redis.set(key, String(process.pid), 'EX', ttlSeconds, 'NX');
    if (acquired !== 'OK') return false;
    try {
      await fn();
    } finally {
      await this.redis.del(key).catch(() => undefined);
    }
    return true;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Redis(config.redisUrl, { maxRetriesPerRequest: 2 }),
    },
    RedisLifecycle,
    RateLimiter,
    JobLock,
  ],
  exports: [REDIS, RateLimiter, JobLock],
})
export class RedisModule {}
