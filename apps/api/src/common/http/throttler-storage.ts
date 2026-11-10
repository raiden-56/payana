import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed counter for @nestjs/throttler so that request limits are
 * shared by every API instance instead of being per-process.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;

    const blockedTtl = await this.redis.pttl(blockKey);
    if (blockedTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockedTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtl / 1000),
      };
    }

    const totalHits = await this.redis.incr(hitsKey);
    if (totalHits === 1) await this.redis.pexpire(hitsKey, ttl);
    let timeToExpire = await this.redis.pttl(hitsKey);
    if (timeToExpire < 0) {
      await this.redis.pexpire(hitsKey, ttl);
      timeToExpire = ttl;
    }

    if (totalHits > limit) {
      const duration = blockDuration > 0 ? blockDuration : timeToExpire;
      await this.redis.set(blockKey, '1', 'PX', Math.max(duration, 1));
      return {
        totalHits,
        timeToExpire: Math.ceil(timeToExpire / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(duration / 1000),
      };
    }
    return { totalHits, timeToExpire: Math.ceil(timeToExpire / 1000), isBlocked: false, timeToBlockExpire: 0 };
  }
}
