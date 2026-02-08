import IORedis, { type Redis } from 'ioredis';

export function createRedisConnection(redisUrl: string, opts?: { role?: string }): Redis {
  const role = opts?.role ? `:${opts.role}` : '';
  const redis = new IORedis(redisUrl, {
    // BullMQ recommends disabling per-command retries to avoid weird stalls.
    maxRetriesPerRequest: null,
  });
  redis.on('error', (e) => {
    // eslint-disable-next-line no-console
    console.error(`[redis${role}]`, e);
  });
  return redis;
}

