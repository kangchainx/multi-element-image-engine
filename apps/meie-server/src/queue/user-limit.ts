import type { Redis } from 'ioredis';

function inflightKey(userId: string): string {
  return `meie:user:${userId}:inflight`;
}

const ACQUIRE_LUA = `
local key = KEYS[1]
local jobId = ARGV[1]
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local added = redis.call('SADD', key, jobId)
local n = redis.call('SCARD', key)
if n > limit then
  if added == 1 then
    redis.call('SREM', key, jobId)
  end
  n = redis.call('SCARD', key)
  return {0, n}
end

redis.call('EXPIRE', key, ttl)
return {1, n}
`;

const RELEASE_LUA = `
local key = KEYS[1]
local jobId = ARGV[1]

redis.call('SREM', key, jobId)
local n = redis.call('SCARD', key)
if n == 0 then
  redis.call('DEL', key)
end
return n
`;

export async function acquireUserInflight(
  redis: Redis,
  userId: string,
  jobId: string,
  opts?: { limit?: number; ttlSeconds?: number },
): Promise<{ ok: true; inflight: number; limit: number } | { ok: false; inflight: number; limit: number }> {
  const limit = opts?.limit ?? 3;
  const ttlSeconds = opts?.ttlSeconds ?? 86400;
  const key = inflightKey(userId);
  const r = (await redis.eval(ACQUIRE_LUA, 1, key, jobId, String(limit), String(ttlSeconds))) as any;
  const ok = Array.isArray(r) ? Number(r[0]) === 1 : false;
  const inflight = Array.isArray(r) ? Number(r[1]) : 0;
  return ok ? { ok: true, inflight, limit } : { ok: false, inflight, limit };
}

export async function releaseUserInflight(redis: Redis, userId: string, jobId: string): Promise<void> {
  const key = inflightKey(userId);
  try {
    await redis.eval(RELEASE_LUA, 1, key, jobId);
  } catch {
    // best-effort
  }
}

