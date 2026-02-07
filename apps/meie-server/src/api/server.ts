import http, { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

import { loadConfig } from '../lib/config.js';
import {
  createJobOrThrow,
  getJob,
  getJobEventsSince,
  getJobResults,
  insertJobEvent,
  markJobCanceled,
  markJobFailed,
  markJobQueued,
  openDb,
  requestCancel,
  upsertJobFile,
} from '../db/db.js';
import { parseMultipartForm } from '../http/multipart.js';
import { guessImageExt, safeRelPath, sanitizeHeaderToken, sha256Hex } from '../lib/utils.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);

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

  let parsed: Awaited<ReturnType<typeof parseMultipartForm>>;
  try {
    parsed = await parseMultipartForm(req, { maxBytes: cfg.maxUploadBytes, maxFiles: cfg.maxFiles });
  } catch (e) {
    badRequest(res, e instanceof Error ? e.message : 'invalid multipart');
    return;
  }

  const refParts = parsed.files.filter((f) => f.fieldName === 'ref');
  const srcParts = parsed.files.filter((f) => f.fieldName === 'sources');
  if (refParts.length !== 1) {
    badRequest(res, 'expected exactly 1 file field named "ref"');
    return;
  }
  if (srcParts.length < 1) {
    badRequest(res, 'expected >=1 file field named "sources"');
    return;
  }

  const paramsRaw = (parsed.fields['params'] || [])[0];
  const params = paramsRaw ? parseJsonField<Record<string, any>>(paramsRaw) : null;
  if (paramsRaw && !params) {
    badRequest(res, 'invalid params JSON');
    return;
  }
  const debug = ((parsed.fields['debug'] || [])[0] || '').trim() === '1';

  const jobId = randomUUID();

  // Insert a "creating" job row with concurrency guard (<=3 outstanding).
  const cr = createJobOrThrow(db, {
    jobId,
    userId,
    timeoutSeconds: cfg.jobTimeoutSeconds,
    noProgressTimeoutSeconds: cfg.noProgressTimeoutSeconds,
    paramsJson: params ? JSON.stringify(params) : null,
    debug,
  });
  if (!cr.ok) {
    tooMany(res, 'too many concurrent jobs for this user', { inflight: cr.inflight, limit: 3 });
    return;
  }

  const runDirRel = safeRelPath(cfg.uploadSubdir, jobId);
  const runDirAbs = path.join(cfg.comfyInputDir, runDirRel);

  try {
    fs.mkdirSync(runDirAbs, { recursive: true });

    const ref = refParts[0];
    const refExt = guessImageExt(ref.filename, ref.contentType || undefined);
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
      const ext = guessImageExt(src.filename, src.contentType || undefined);
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

    sendJson(res, 202, { jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    markJobFailed(db, jobId, msg);
    insertJobEvent(db, jobId, 'error', { message: msg });
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

async function handleCancel(jobId: string, res: ServerResponse): Promise<void> {
  const job = getJob(db, jobId);
  if (!job) {
    notFound(res);
    return;
  }
  if (job.state === 'queued' || job.state === 'creating') {
    markJobCanceled(db, jobId, 'canceled by user');
    insertJobEvent(db, jobId, 'state', { state: 'canceled' });
    sendJson(res, 200, { ok: true, state: 'canceled' });
    return;
  }
  if (job.state === 'running') {
    requestCancel(db, jobId);
    insertJobEvent(db, jobId, 'log', { message: 'cancel requested; worker will stop ASAP' });
    sendJson(res, 202, { ok: true, state: 'cancel_requested' });
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

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx: disable buffering if present
  res.setHeader('X-Accel-Buffering', 'no');

  // Snapshot
  sseWrite(res, { event: 'snapshot', data: jobPublic(jobId) });

  let lastId = 0;
  const lastEventIdHeader = String(req.headers['last-event-id'] || '').trim();
  if (lastEventIdHeader) {
    const n = Number(lastEventIdHeader);
    if (Number.isFinite(n) && n > 0) lastId = Math.trunc(n);
  }

  // Replay existing events after lastId (client can resume).
  for (const ev of getJobEventsSince(db, jobId, lastId, 200)) {
    lastId = ev.id;
    sseWrite(res, { id: ev.id, event: ev.event_type, data: parseJsonField(ev.payload_json) ?? ev.payload_json });
  }

  // Poll loop (no BullMQ deps in this environment).
  const pollMs = 500;
  const pingMs = 15000;
  let closed = false;
  let lastPingAt = Date.now();

  const timer = setInterval(() => {
    if (closed) return;
    try {
      const events = getJobEventsSince(db, jobId, lastId, 200);
      for (const ev of events) {
        lastId = ev.id;
        sseWrite(res, { id: ev.id, event: ev.event_type, data: parseJsonField(ev.payload_json) ?? ev.payload_json });
      }
      const now = Date.now();
      if (now - lastPingAt >= pingMs) {
        lastPingAt = now;
        res.write(`: ping ${now}\n\n`);
      }
    } catch {
      // ignore polling errors; connection will drop naturally if fatal.
    }
  }, pollMs);

  req.on('close', () => {
    closed = true;
    clearInterval(timer);
    try {
      res.end();
    } catch {
      // ignore
    }
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
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/jobs') {
        await handleCreateJob(req, res);
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

  server.listen(cfg.port, cfg.host, () => {
    // eslint-disable-next-line no-console
    console.log(`MEIE API listening on http://${cfg.host}:${cfg.port}`);
    console.log(`ComfyUI: ${cfg.comfyuiApiBase}`);
    console.log(`ComfyUI input: ${cfg.comfyInputDir}`);
    console.log(`Uploads: ${cfg.uploadSubdir}/<jobId>/...`);
    console.log(`DB: ${cfg.dbPath}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', e);
  process.exit(1);
});
