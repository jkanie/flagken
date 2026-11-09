import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

// Counts hits in a fixed window and blocks for blockDuration once the limit is passed. 1 round trip per request.
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, ttl, blocked}
`;

/**
 * Rate-limit counters in Redis, so the limit holds across every server instance
 * (the throttler's default store counts per process).
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const base = `${this.prefix}:throttle:${throttlerName}:${key}`;
    const [hits, ttlLeft, blockLeft] = (await this.redis.eval(
      SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      String(ttl),
      String(limit),
      String(Math.max(blockDuration, 1)),
    )) as [number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.max(Math.ceil(ttlLeft / 1000), 0),
      isBlocked: blockLeft > 0,
      timeToBlockExpire: Math.max(Math.ceil(blockLeft / 1000), 0),
    };
  }
}
