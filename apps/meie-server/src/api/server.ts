import http, { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

import { loadConfig } from '../lib/config.js';
import {
  createJob,
  getJob,
  getJobResults,
  insertJobEvent,
  listJobsByUser,
  markJobCanceled,
  markJobFailed,
  markJobQueued,
  openDb,
  requestCancel,
  upsertJobFile,
} from '../db/db.js';
import { parseMultipartForm } from '../http/multipart.js';
import { safeRelPath, sanitizeHeaderToken, sha256Hex, sniffImageExt } from '../lib/utils.js';
import { jobLog, log } from '../lib/log.js';
import { createQueue, createQueueEvents } from '../queue/queue.js';
import { createRedisConnection } from '../queue/redis.js';
import { acquireUserInflight, releaseUserInflight } from '../queue/user-limit.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const redis = createRedisConnection(cfg.redisUrl, { role: 'api' });
const queue = createQueue(cfg.queueName, redis);
const queueEvents = createQueueEvents(cfg.queueName, createRedisConnection(cfg.redisUrl, { role: 'api-events' }));

const sseSubscribers = new Map<string, Set<ServerResponse>>();

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function sendJson(res: ServerResponse, status: number, body: any): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'not_found' });
}

function badRequest(res: ServerResponse, message: string): void {
  sendJson(res, 400, { error: 'bad_request', message });
}

function tooMany(res: ServerResponse, message: string, extra?: any): void {
  sendJson(res, 429, { error: 'too_many_requests', message, ...extra });
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'method_not_allowed' });
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-User-Id,Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
}

function parseJsonField<T = any>(v: string | undefined): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

function jobPublic(jobId: string): any {
  const job = getJob(db, jobId);
  if (!job) return null;
  const results = job.state === 'completed' ? getJobResults(db, jobId) : [];
  const images = results.map((r) => ({
    idx: r.idx,
    url: `/v1/jobs/${jobId}/images/${r.idx}`,
  }));
  const progress = job.progress_json ? (parseJsonField(job.progress_json) as Json) : null;
  return {
    id: job.job_id,
    user_id: job.user_id,
    state: job.state,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    comfy_prompt_id: job.comfy_prompt_id,
    error: job.error,
    progress,
    images,
  };
}

function jobPublicFromRow(job: any): any {
  const jobId = String(job.job_id);
  const results = job.state === 'completed' ? getJobResults(db, jobId) : [];
  const images = results.map((r) => ({
    idx: r.idx,
    url: `/v1/jobs/${jobId}/images/${r.idx}`,
  }));
  const progress = job.progress_json ? (parseJsonField(job.progress_json) as Json) : null;
  return {
    id: jobId,
    user_id: job.user_id,
    state: job.state,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    comfy_prompt_id: job.comfy_prompt_id,
    error: job.error,
    progress,
    images,
  };
}

function sseWrite(res: ServerResponse, evt: { id?: number; event: string; data: any }): void {
  if (evt.id !== undefined) res.write(`id: ${evt.id}\n`);
  res.write(`event: ${evt.event}\n`);
  const data = typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data ?? {});
  for (const line of data.split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

async function handleCreateJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const userIdRaw = String(req.headers['x-user-id'] || '').trim();
  if (!userIdRaw) {
    badRequest(res, 'missing X-User-Id header');
    return;
  }
  const userId = sanitizeHeaderToken(userIdRaw);

  const jobId = randomUUID();
  jobLog(jobId, 'info', 'create: request received', { userId });

  const acquired = await acquireUserInflight(redis, userId, jobId, { limit: 3, ttlSeconds: 86400 });
  if (!acquired.ok) {
    jobLog(jobId, 'warn', 'create: rejected by inflight limit', { inflight: acquired.inflight, limit: acquired.limit });
    tooMany(res, 'too many concurrent jobs for this user', { inflight: acquired.inflight, limit: acquired.limit });
    return;
  }

  let parsed: Awaited<ReturnType<typeof parseMultipartForm>>;
  try {
    parsed = await parseMultipartForm(req, { maxBytes: cfg.maxUploadBytes, maxFiles: cfg.maxFiles });
  } catch (e) {
    jobLog(jobId, 'warn', 'create: multipart parse failed', { message: e instanceof Error ? e.message : String(e) });
    await releaseUserInflight(redis, userId, jobId);
    badRequest(res, e instanceof Error ? e.message : 'invalid multipart');
    return;
  }

  const refParts = parsed.files.filter((f) => f.fieldName === 'ref');
  const srcParts = parsed.files.filter((f) => f.fieldName === 'sources');
  if (refParts.length !== 1) {
    jobLog(jobId, 'warn', 'create: invalid ref parts', { count: refParts.length });
    await releaseUserInflight(redis, userId, jobId);
    badRequest(res, 'expected exactly 1 file field named "ref"');
    return;
  }
  if (srcParts.length < 1) {
    jobLog(jobId, 'warn', 'create: missing sources', { count: srcParts.length });
    await releaseUserInflight(redis, userId, jobId);
    badRequest(res, 'expected >=1 file field named "sources"');
    return;
  }

  const paramsRaw = (parsed.fields['params'] || [])[0];
  const params = paramsRaw ? parseJsonField<Record<string, any>>(paramsRaw) : null;
  if (paramsRaw && !params) {
    jobLog(jobId, 'warn', 'create: invalid params JSON');
    await releaseUserInflight(redis, userId, jobId);
    badRequest(res, 'invalid params JSON');
    return;
  }
  const debug = ((parsed.fields['debug'] || [])[0] || '').trim() === '1';
  jobLog(jobId, 'info', 'create: parsed multipart', {
    ref: { name: refParts[0]?.filename, bytes: refParts[0]?.data?.length ?? 0 },
    sources: srcParts.map((s) => ({ name: s.filename, bytes: s.data?.length ?? 0 })).slice(0, 5),
    sourcesCount: srcParts.length,
    debug,
    hasParams: Boolean(paramsRaw),
  });

  const runDirRel = safeRelPath(cfg.uploadSubdir, jobId);
  const runDirAbs = path.join(cfg.comfyInputDir, runDirRel);

  try {
    createJob(db, {
      jobId,
      userId,
      timeoutSeconds: cfg.jobTimeoutSeconds,
      noProgressTimeoutSeconds: cfg.noProgressTimeoutSeconds,
      paramsJson: params ? JSON.stringify(params) : null,
      debug,
    });

    fs.mkdirSync(runDirAbs, { recursive: true });
    jobLog(jobId, 'info', 'create: writing input files', { runDirAbs });

    const ref = refParts[0];
    const refExt = sniffImageExt(ref.data);
    if (!refExt) {
      jobLog(jobId, 'warn', 'create: unsupported ref image format', { filename: ref.filename, contentType: ref.contentType });
      await releaseUserInflight(redis, userId, jobId);
      badRequest(res, `unsupported ref image format (supported: png/jpg/webp). filename=${ref.filename}`);
      return;
    }
    const refName = `ref${refExt}`;
    const refRel = safeRelPath(runDirRel, refName);
    fs.writeFileSync(path.join(runDirAbs, refName), ref.data);
    upsertJobFile(db, {
      jobId,
      role: 'ref',
      idx: 0,
      relPath: refRel,
      origName: ref.filename,
      bytes: ref.data.length,
      sha256: sha256Hex(ref.data),
    });

    const srcRels: string[] = [];
    for (let i = 0; i < srcParts.length; i++) {
      const src = srcParts[i];
      const ext = sniffImageExt(src.data);
      if (!ext) {
        jobLog(jobId, 'warn', 'create: unsupported source image format', { filename: src.filename, contentType: src.contentType });
        await releaseUserInflight(redis, userId, jobId);
        badRequest(res, `unsupported source image format (supported: png/jpg/webp). filename=${src.filename}`);
        return;
      }
      const name = `src_${i}${ext}`;
      const rel = safeRelPath(runDirRel, name);
      fs.writeFileSync(path.join(runDirAbs, name), src.data);
      srcRels.push(rel);
      upsertJobFile(db, {
        jobId,
        role: 'src',
        idx: i,
        relPath: rel,
        origName: src.filename,
        bytes: src.data.length,
        sha256: sha256Hex(src.data),
      });
    }

    // Write manifest for debugging/repro.
    const manifest = {
      jobId,
      userId,
      createdAt: Date.now(),
      ref: { rel: refRel, orig: ref.filename, bytes: ref.data.length },
      sources: srcParts.map((s, i) => ({ idx: i, rel: srcRels[i], orig: s.filename, bytes: s.data.length })),
      params: params || {},
      debug,
    };
    fs.writeFileSync(path.join(runDirAbs, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    markJobQueued(db, jobId, { refRel, srcRels, debug });
    insertJobEvent(db, jobId, 'state', { state: 'queued' });
    jobLog(jobId, 'info', 'create: queued in DB', { refRel, sources: srcRels.length });

    await queue.add('dual-track', { jobId, userId }, { jobId });
    jobLog(jobId, 'info', 'create: enqueued to BullMQ', { queue: cfg.queueName });

    sendJson(res, 202, { jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    jobLog(jobId, 'error', 'create: internal error', { message: msg });
    markJobFailed(db, jobId, msg);
    insertJobEvent(db, jobId, 'error', { message: msg });
    await releaseUserInflight(redis, userId, jobId);
    sendJson(res, 500, { error: 'internal_error', message: msg });
  }
}

async function handleGetJob(jobId: string, res: ServerResponse): Promise<void> {
  const pub = jobPublic(jobId);
  if (!pub) {
    notFound(res);
    return;
  }
  sendJson(res, 200, pub);
}

async function handleListJobs(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const userIdRaw = String(req.headers['x-user-id'] || '').trim();
  if (!userIdRaw) {
    badRequest(res, 'missing X-User-Id header');
    return;
  }
  const userId = sanitizeHeaderToken(userIdRaw);

  const limitRaw = url.searchParams.get('limit');
  const limitN = limitRaw ? Number(limitRaw) : NaN;
  const limit = Number.isFinite(limitN) ? Math.trunc(limitN) : 50;
  const safeLimit = Math.max(1, Math.min(200, limit));

  const allowedStates = new Set(['creating', 'queued', 'running', 'completed', 'failed', 'canceled']);
  const stateRaw = (url.searchParams.get('state') || '').trim().toLowerCase();

  let states: any[] | null = null;
  if (!stateRaw || stateRaw === 'all') {
    states = null;
  } else if (stateRaw === 'active') {
    states = ['creating', 'queued', 'running'];
  } else if (stateRaw === 'terminal' || stateRaw === 'done') {
    states = ['completed', 'failed', 'canceled'];
  } else {
    const parts = stateRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => allowedStates.has(s));
    states = parts.length > 0 ? parts : null;
  }

  const rows = listJobsByUser(db, userId, { states: states as any, limit: safeLimit });
  sendJson(res, 200, rows.map(jobPublicFromRow));
}

async function handleCancel(jobId: string, res: ServerResponse): Promise<void> {
  const job = getJob(db, jobId);
  if (!job) {
    notFound(res);
    return;
  }

  try {
    const bullJob = await queue.getJob(jobId);
    const bullState = bullJob ? await bullJob.getState() : null;

    if (bullJob && bullState && ['waiting', 'delayed', 'paused'].includes(bullState)) {
      await bullJob.remove();
      markJobCanceled(db, jobId, 'canceled by user');
      insertJobEvent(db, jobId, 'state', { state: 'canceled' });
      await releaseUserInflight(redis, job.user_id, jobId);
      sendJson(res, 200, { ok: true, state: 'canceled' });
      return;
    }

    if (bullState === 'active' || job.state === 'running') {
      requestCancel(db, jobId);
      insertJobEvent(db, jobId, 'log', { message: 'cancel requested; worker will stop ASAP' });
      sendJson(res, 202, { ok: true, state: 'cancel_requested' });
      return;
    }
  } catch {
    // ignore queue errors; fall back to DB state
  }

  if (job.state === 'queued' || job.state === 'creating') {
    markJobCanceled(db, jobId, 'canceled by user');
    insertJobEvent(db, jobId, 'state', { state: 'canceled' });
    await releaseUserInflight(redis, job.user_id, jobId);
    sendJson(res, 200, { ok: true, state: 'canceled' });
    return;
  }

  sendJson(res, 200, { ok: true, state: job.state });
}

async function handleSse(jobId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const job = getJob(db, jobId);
  if (!job) {
    notFound(res);
    return;
  }
  jobLog(jobId, 'info', 'sse: client subscribed');

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx: disable buffering if present
  res.setHeader('X-Accel-Buffering', 'no');

  // Snapshot
  sseWrite(res, { event: 'snapshot', data: jobPublic(jobId) });

  const pingMs = 15000;
  let closed = false;
  let lastPingAt = Date.now();

  const sub = sseSubscribers.get(jobId) || new Set<ServerResponse>();
  sub.add(res);
  sseSubscribers.set(jobId, sub);

  const timer = setInterval(() => {
    if (closed) return;
    const now = Date.now();
    if (now - lastPingAt >= pingMs) {
      lastPingAt = now;
      res.write(`: ping ${now}\n\n`);
    }
  }, pingMs);

  req.on('close', () => {
    closed = true;
    clearInterval(timer);
    const set = sseSubscribers.get(jobId);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseSubscribers.delete(jobId);
    }
    try {
      res.end();
    } catch {
      // ignore
    }
    jobLog(jobId, 'info', 'sse: client disconnected');
  });
}

async function handleProxyImage(jobId: string, idx: number, res: ServerResponse): Promise<void> {
  const job = getJob(db, jobId);
  if (!job) {
    notFound(res);
    return;
  }
  const results = getJobResults(db, jobId);
  const r = results.find((x) => x.idx === idx);
  if (!r) {
    notFound(res);
    return;
  }

  const viewUrl = `${cfg.comfyuiApiBase}/view?${new URLSearchParams({
    filename: r.filename,
    subfolder: r.subfolder || '',
    type: r.type || 'output',
  }).toString()}`;

  const rr = await fetch(viewUrl);
  if (!rr.ok || !rr.body) {
    const text = await rr.text().catch(() => '');
    sendJson(res, 502, { error: 'bad_gateway', message: `ComfyUI /view failed (${rr.status})`, details: text.slice(0, 200) });
    return;
  }

  res.statusCode = 200;
  const ct = rr.headers.get('content-type');
  if (ct) res.setHeader('Content-Type', ct);
  const cl = rr.headers.get('content-length');
  if (cl) res.setHeader('Content-Length', cl);

  // rr.body is a Web stream; bridge to Node stream.
  const nodeStream = Readable.fromWeb(rr.body as any);
  nodeStream.pipe(res);
}

async function main(): Promise<void> {
  await queueEvents.waitUntilReady();
  log('info', `queueEvents ready (queue=${cfg.queueName})`);

  function broadcast(jobId: string, event: string, data: any): void {
    const subs = sseSubscribers.get(jobId);
    if (!subs || subs.size === 0) return;
    for (const r of subs) {
      try {
        sseWrite(r, { event, data });
      } catch {
        // ignore
      }
    }
  }

  const lastProgressLogAt = new Map<string, number>();
  const shouldLogProgress = (jobId: string) => {
    const now = Date.now();
    const last = lastProgressLogAt.get(jobId) || 0;
    if (now - last < 2000) return false; // throttle
    lastProgressLogAt.set(jobId, now);
    return true;
  };

  queueEvents.on('active', ({ jobId }) => {
    if (!jobId) return;
    jobLog(String(jobId), 'info', 'queueEvents: active (running)');
    broadcast(String(jobId), 'state', { state: 'running' });
  });
  queueEvents.on('progress', ({ jobId, data }) => {
    if (!jobId) return;
    if (shouldLogProgress(String(jobId))) jobLog(String(jobId), 'debug', 'queueEvents: progress', data);
    broadcast(String(jobId), 'progress', data);
  });
  queueEvents.on('completed', ({ jobId }) => {
    if (!jobId) return;
    const id = String(jobId);
    jobLog(id, 'info', 'queueEvents: completed');
    broadcast(id, 'completed', jobPublic(id));
  });
  queueEvents.on('failed', ({ jobId, failedReason }) => {
    if (!jobId) return;
    jobLog(String(jobId), 'warn', 'queueEvents: failed', { message: failedReason || 'failed' });
    broadcast(String(jobId), 'failed', { message: failedReason || 'failed' });
  });

  const server = http.createServer(async (req, res) => {
    try {
      setCors(res);
      const method = req.method || 'GET';
      if (method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (method === 'GET' && url.pathname === '/healthz') {
        sendJson(res, 200, {
          ok: true,
          comfyui: cfg.comfyuiApiBase,
          comfy_input_dir: cfg.comfyInputDir,
          db: cfg.dbPath,
          redis: cfg.redisUrl,
          queue: cfg.queueName,
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/jobs') {
        await handleCreateJob(req, res);
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/jobs') {
        await handleListJobs(req, res, url);
        return;
      }

      const mJob = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)$/i);
      if (method === 'GET' && mJob) {
        await handleGetJob(mJob[1], res);
        return;
      }

      const mSse = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)\/events$/i);
      if (method === 'GET' && mSse) {
        await handleSse(mSse[1], req, res);
        return;
      }

      const mImg = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)\/images\/(\d+)$/i);
      if (method === 'GET' && mImg) {
        await handleProxyImage(mImg[1], Number(mImg[2]), res);
        return;
      }

      const mCancel = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)\/cancel$/i);
      if (method === 'POST' && mCancel) {
        await handleCancel(mCancel[1], res);
        return;
      }

      if (method === 'GET' && url.pathname === '/') {
        sendJson(res, 200, {
          ok: true,
          service: 'meie-api',
          endpoints: [
            'POST /v1/jobs (multipart: ref + sources[] + params + debug)',
            'GET  /v1/jobs (list jobs; requires X-User-Id)',
            'GET  /v1/jobs/:jobId',
            'GET  /v1/jobs/:jobId/events (SSE)',
            'GET  /v1/jobs/:jobId/images/:idx',
            'POST /v1/jobs/:jobId/cancel',
          ],
        });
        return;
      }

      if (['GET', 'POST', 'OPTIONS'].includes(method)) {
        notFound(res);
        return;
      }
      methodNotAllowed(res);
    } catch (e) {
      sendJson(res, 500, { error: 'internal_error', message: e instanceof Error ? e.message : String(e) });
    }
  });

  server.on('error', (e: any) => {
    const err = e as any;
    if (err && err.code === 'EADDRINUSE') {
      log('error', `listen failed: ${cfg.host}:${cfg.port} already in use`);
      log('error', `Tip: find PID via "netstat -ano | findstr :${cfg.port}" then "taskkill /PID <pid> /T /F"`);
      process.exitCode = 1;
      try {
        server.close();
      } catch {
        // ignore
      }
      return;
    }
    log('error', 'server error', { message: err?.message || String(err) });
    process.exitCode = 1;
  });

  server.listen(cfg.port, cfg.host, () => {
    // eslint-disable-next-line no-console
    console.log(`MEIE API listening on http://${cfg.host}:${cfg.port}`);
    console.log(`ComfyUI: ${cfg.comfyuiApiBase}`);
    console.log(`ComfyUI input: ${cfg.comfyInputDir}`);
    console.log(`Uploads: ${cfg.uploadSubdir}/<jobId>/...`);
    console.log(`DB: ${cfg.dbPath}`);
    console.log(`Redis: ${cfg.redisUrl}`);
    console.log(`Queue: ${cfg.queueName}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', e);
  process.exit(1);
});
