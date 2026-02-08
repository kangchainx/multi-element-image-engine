import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { loadConfig } from '../lib/config.js';
import {
  getJob,
  insertJobEvent,
  markJobCanceled,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  openDb,
  replaceJobResults,
  setJobComfyPromptId,
  setJobProgress,
} from '../db/db.js';
import { getHistoryEntry, comfyWsUrl, getObjectInfo, listWorkflowNodeTypes, submitWorkflow } from '../lib/comfy.js';
import { buildDualTrackWorkflow, loadBaseWorkflow, type DualTrackParams, type Workflow } from '../workflows/dual-track.js';
import { nowMs, sleep } from '../lib/utils.js';
import { jobLog, log } from '../lib/log.js';
import { createWorker } from '../queue/queue.js';
import { createRedisConnection } from '../queue/redis.js';
import { releaseUserInflight } from '../queue/user-limit.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const redis = createRedisConnection(cfg.redisUrl, { role: 'worker' });

type QueueJobData = { jobId: string; userId: string };

function parseParamsJson(paramsJson: string | null): DualTrackParams {
  if (!paramsJson) return {};
  try {
    const v = JSON.parse(paramsJson);
    return v && typeof v === 'object' ? (v as DualTrackParams) : {};
  } catch {
    return {};
  }
}

function safeUpdateProgress(bullJob: any, payload: any): void {
  try {
    void bullJob?.updateProgress(payload);
  } catch {
    // ignore
  }
}

function startComfyProgressWs(opts: {
  comfyuiApiBase: string;
  clientId: string;
  promptId: string;
  workflow: Workflow;
  jobId: string;
  bullJob: any;
  onProgress: (p: any) => void;
  onExecuting: (e: any) => void;
  onError: (e: any) => void;
}): { close: () => void; lastProgressAtRef: { v: number } } {
  const url = comfyWsUrl(opts.comfyuiApiBase, opts.clientId);
  const WS = (globalThis as any).WebSocket as any;
  const lastProgressAtRef = { v: nowMs() };

  if (!WS) {
    insertJobEvent(db, opts.jobId, 'log', { message: 'WebSocket global not available; progress events disabled' });
    jobLog(opts.jobId, 'warn', 'ws: WebSocket global not available; progress disabled');
    return { close: () => {}, lastProgressAtRef };
  }

  let closed = false;
  let lastExecKey = '';
  let lastProgressLogAt = 0;

  try {
    const ws = new WS(url);

    ws.onopen = () => {
      insertJobEvent(db, opts.jobId, 'log', { message: `ws connected: ${url}` });
      jobLog(opts.jobId, 'info', 'ws: connected', { url });
    };
    ws.onerror = () => {
      if (!closed) insertJobEvent(db, opts.jobId, 'log', { message: 'ws error' });
      if (!closed) jobLog(opts.jobId, 'warn', 'ws: error');
    };
    ws.onclose = () => {
      if (!closed) insertJobEvent(db, opts.jobId, 'log', { message: 'ws closed' });
      if (!closed) jobLog(opts.jobId, 'warn', 'ws: closed');
    };
    ws.onmessage = (evt: any) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'executing' && msg.data?.prompt_id === opts.promptId) {
        lastProgressAtRef.v = nowMs();
        const nodeId = String(msg.data?.node ?? '');
        const node = opts.workflow[nodeId];
        const title = node?._meta?.title || '';
        const cls = node?.class_type || '';
        const key = `${nodeId}:${title}:${cls}`;
        if (key && key !== lastExecKey) {
          lastExecKey = key;
          const payload = { nodeId, title, classType: cls };
          opts.onExecuting(payload);
          safeUpdateProgress(opts.bullJob, { phase: 'executing', ...payload, ts: Date.now() });
          jobLog(opts.jobId, 'debug', 'progress: executing', payload);
        }
      } else if (msg.type === 'progress' && msg.data?.prompt_id === opts.promptId) {
        lastProgressAtRef.v = nowMs();
        const v = msg.data?.value;
        const m = msg.data?.max;
        if (typeof v === 'number' && typeof m === 'number') {
          const payload = { step: v, steps: m };
          opts.onProgress(payload);
          safeUpdateProgress(opts.bullJob, { phase: 'sampling', ...payload, ts: Date.now() });

          // Avoid writing too many rows; debounce to ~1Hz for logs.
          if (nowMs() - lastProgressLogAt > 1000) {
            lastProgressLogAt = nowMs();
            setJobProgress(db, opts.jobId, payload);
            jobLog(opts.jobId, 'debug', 'progress: sampling', payload);
          }
        }
      } else if (msg.type === 'execution_error' && msg.data?.prompt_id === opts.promptId) {
        lastProgressAtRef.v = nowMs();
        opts.onError({ type: 'execution_error', data: msg.data });
        jobLog(opts.jobId, 'warn', 'progress: execution_error', msg.data);
      }
    };

    return {
      close: () => {
        closed = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
      },
      lastProgressAtRef,
    };
  } catch (e) {
    insertJobEvent(db, opts.jobId, 'log', { message: `ws connect failed: ${e instanceof Error ? e.message : String(e)}` });
    return { close: () => {}, lastProgressAtRef };
  }
}

async function pollHistoryUntilDone(opts: {
  comfyuiApiBase: string;
  promptId: string;
  jobId: string;
  timeoutSeconds: number;
  noProgressTimeoutSeconds: number;
  lastProgressAtRef: { v: number };
}): Promise<any> {
  const startedAt = nowMs();
  let lastHeartbeatAt = 0;
  while (true) {
    // Cancel?
    const job = getJob(db, opts.jobId);
    if (job?.cancel_requested) throw new Error('canceled');

    const elapsed = (nowMs() - startedAt) / 1000;
    if (elapsed > opts.timeoutSeconds) throw new Error(`timeout after ${Math.trunc(elapsed)}s`);

    const noProg = (nowMs() - opts.lastProgressAtRef.v) / 1000;
    if (noProg > opts.noProgressTimeoutSeconds) throw new Error(`no progress for ${Math.trunc(noProg)}s`);

    if (nowMs() - lastHeartbeatAt > 10_000) {
      lastHeartbeatAt = nowMs();
      jobLog(opts.jobId, 'info', 'poll: waiting for ComfyUI history', {
        elapsed_s: Math.trunc(elapsed),
        no_progress_s: Math.trunc(noProg),
        promptId: opts.promptId,
      });
    }

    const h = await getHistoryEntry(opts.comfyuiApiBase, opts.promptId);
    if (h) return h;
    await sleep(1000);
  }
}

function absInputPath(comfyInputDir: string, rel: string): string {
  // rel stored in DB/workflow is POSIX-ish with forward slashes.
  const parts = String(rel || '').split('/').filter(Boolean);
  return path.join(comfyInputDir, ...parts);
}

function listLoadImageNodes(workflow: Workflow): Array<{ nodeId: string; image: string; title?: string }> {
  const out: Array<{ nodeId: string; image: string; title?: string }> = [];
  for (const [nodeId, node] of Object.entries(workflow || {})) {
    if (!node || typeof node !== 'object') continue;
    if (node.class_type !== 'LoadImage') continue;
    const image = (node.inputs as any)?.image;
    if (typeof image !== 'string' || !image.trim()) continue;
    const title = node?._meta?.title;
    out.push({ nodeId, image: image.trim(), title: typeof title === 'string' ? title : undefined });
  }
  return out;
}

async function processJob(jobId: string, bullJob: any, baseWorkflow: Workflow): Promise<void> {
  const row = getJob(db, jobId);
  if (!row) throw new Error('job not found');

  if (!row.ref_rel || !row.src_rels_json) throw new Error('missing input file refs in DB');

  jobLog(jobId, 'info', 'worker: job started', {
    userId: row.user_id,
    ref: row.ref_rel,
    sources: (() => {
      try {
        const s = JSON.parse(row.src_rels_json) as any[];
        return Array.isArray(s) ? s.length : 0;
      } catch {
        return 0;
      }
    })(),
    debug: Boolean(row.debug),
  });

  markJobRunning(db, jobId);
  insertJobEvent(db, jobId, 'state', { state: 'running' });
  setJobProgress(db, jobId, { phase: 'running' });
  safeUpdateProgress(bullJob, { phase: 'running', ts: Date.now() });

  const srcRels = JSON.parse(row.src_rels_json) as string[];
  const params = parseParamsJson(row.params_json);
  if (!params.ipadapter_crop_position) params.ipadapter_crop_position = 'pad';

  jobLog(jobId, 'info', 'worker: building workflow', { comfy: cfg.comfyuiApiBase });
  const workflow = buildDualTrackWorkflow({
    base: baseWorkflow,
    jobId,
    outputDirPrefix: cfg.outputDirPrefix,
    refRel: row.ref_rel,
    srcRels,
    params,
    debug: Boolean(row.debug),
  });

  // Guarantee the workflow only reads the exact uploaded images we saved for this job.
  // If the base workflow references some other input filename, fail fast with a clear error.
  const allowed = new Set<string>([row.ref_rel, ...srcRels].filter(Boolean));
  const loadNodes = listLoadImageNodes(workflow);
  const unexpected = loadNodes.filter((n) => !allowed.has(n.image));
  if (unexpected.length > 0) {
    jobLog(jobId, 'error', 'preflight: workflow references unexpected input images', {
      unexpected,
      allowed: Array.from(allowed),
    });
    throw new Error(
      [
        'Workflow references input images that do not match the files uploaded for this job.',
        'This is blocked to avoid ComfyUI reading the wrong file or failing with "Invalid image file".',
        `Allowed: ${Array.from(allowed).join(', ')}`,
        `Unexpected: ${unexpected.map((u) => `${u.nodeId}:${u.image}`).join(', ')}`,
      ].join(' '),
    );
  }

  // Also ensure the expected input files exist on disk where ComfyUI will read them from.
  for (const rel of allowed) {
    const abs = absInputPath(cfg.comfyInputDir, rel);
    if (!fs.existsSync(abs)) {
      jobLog(jobId, 'error', 'preflight: input file missing on disk', { rel, abs });
      throw new Error(`Input file missing on disk for this job: ${rel} (abs=${abs})`);
    }
  }

  // Preflight: verify ComfyUI supports all node types referenced by this workflow.
  // Fail fast with a clearer error than /prompt 400 missing_node_type.
  const obj = await getObjectInfo(cfg.comfyuiApiBase, 5000);
  if (obj) {
    const types = listWorkflowNodeTypes(workflow);
    const missing = types.filter((t) => !(t in obj));
    if (missing.length > 0) {
      jobLog(jobId, 'error', 'preflight: missing ComfyUI node types', { missing });
      throw new Error(
        [
          `ComfyUI is missing required node types: ${missing.join(', ')}`,
          'Install the corresponding custom nodes in ComfyUI (and restart ComfyUI), or switch to a workflow that does not require them.',
          'Tip: for IPAdapter nodes, ensure your IPAdapter custom node package is installed (e.g. provides IPAdapterModelLoader).',
        ].join(' '),
      );
    }
  } else {
    jobLog(jobId, 'warn', 'preflight: /object_info unavailable; skipping node type verification');
  }

  // Submit to ComfyUI.
  const clientId = randomUUID();
  insertJobEvent(db, jobId, 'log', { message: `submitting to ComfyUI (${cfg.comfyuiApiBase})` });
  jobLog(jobId, 'info', 'worker: submitting to ComfyUI', { comfy: cfg.comfyuiApiBase });
  const submit = await submitWorkflow(cfg.comfyuiApiBase, workflow, clientId);
  setJobComfyPromptId(db, jobId, submit.prompt_id);
  insertJobEvent(db, jobId, 'log', { message: `submitted prompt_id=${submit.prompt_id} queue=${submit.number}` });
  safeUpdateProgress(bullJob, { phase: 'submitted', promptId: submit.prompt_id, queue: submit.number, ts: Date.now() });
  jobLog(jobId, 'info', 'worker: submitted', { promptId: submit.prompt_id, queue: submit.number });

  const ws = startComfyProgressWs({
    comfyuiApiBase: cfg.comfyuiApiBase,
    clientId,
    promptId: submit.prompt_id,
    workflow,
    jobId,
    bullJob,
    onExecuting: (e) => insertJobEvent(db, jobId, 'progress', { phase: 'executing', ...e }),
    onProgress: (p) => insertJobEvent(db, jobId, 'progress', { phase: 'sampling', ...p }),
    onError: (e) => insertJobEvent(db, jobId, 'error', e),
  });

  let history: any;
  try {
    history = await pollHistoryUntilDone({
      comfyuiApiBase: cfg.comfyuiApiBase,
      promptId: submit.prompt_id,
      jobId,
      timeoutSeconds: row.timeout_seconds,
      noProgressTimeoutSeconds: row.no_progress_timeout_seconds,
      lastProgressAtRef: ws.lastProgressAtRef,
    });
  } finally {
    ws.close();
  }

  jobLog(jobId, 'info', 'worker: ComfyUI history ready');
  const outputs = (history?.outputs || {}) as Record<string, any>;
  const finalImgs = Array.isArray(outputs?.['7']?.images) ? (outputs['7'].images as any[]) : [];
  const otherImgs: any[] = [];
  for (const [nodeId, nodeOut] of Object.entries(outputs)) {
    if (nodeId === '7') continue; // keep final first
    for (const img of (nodeOut as any)?.images || []) otherImgs.push(img);
  }
  const imgs = [...finalImgs, ...otherImgs];
  jobLog(jobId, 'info', 'worker: saving results', { images: imgs.length });
  replaceJobResults(
    db,
    jobId,
    imgs.map((img, idx) => ({
      job_id: jobId,
      idx,
      filename: img.filename,
      subfolder: img.subfolder || '',
      type: img.type || 'output',
    })),
  );
  markJobCompleted(db, jobId);
  insertJobEvent(db, jobId, 'state', { state: 'completed' });
  insertJobEvent(db, jobId, 'result', {
    images: imgs.map((_, idx) => ({ idx, url: `/v1/jobs/${jobId}/images/${idx}` })),
  });
  safeUpdateProgress(bullJob, { phase: 'completed', ts: Date.now() });
  jobLog(jobId, 'info', 'worker: completed', { images: imgs.length });
}

async function main(): Promise<void> {
  const baseWorkflow = await loadBaseWorkflow();
  const concurrency = Number(process.env.WORKER_CONCURRENCY || cfg.workerConcurrencyPerProcess || 1);
  log('info', `worker process started pid=${process.pid} concurrency=${concurrency} redis=${cfg.redisUrl} queue=${cfg.queueName}`);
  insertJobEvent(db, 'system', 'log', { message: `worker started pid=${process.pid} concurrency=${concurrency}` });

  const worker = createWorker<QueueJobData, any>(
    cfg.queueName,
    redis,
    async (bullJob: any) => {
      const jobId = String(bullJob?.data?.jobId || bullJob?.id || '');
      const userId = String(bullJob?.data?.userId || '');
      if (!jobId || !userId) throw new Error('missing jobId/userId in queue payload');

      try {
        await processJob(jobId, bullJob, baseWorkflow);
        return { jobId, state: 'completed' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'canceled') {
          markJobCanceled(db, jobId, 'canceled by user');
          insertJobEvent(db, jobId, 'state', { state: 'canceled' });
          safeUpdateProgress(bullJob, { phase: 'canceled', ts: Date.now() });
          return { jobId, state: 'canceled' };
        }

        markJobFailed(db, jobId, msg);
        insertJobEvent(db, jobId, 'state', { state: 'failed' });
        insertJobEvent(db, jobId, 'error', { message: msg });
        safeUpdateProgress(bullJob, { phase: 'failed', message: msg, ts: Date.now() });
        throw e;
      } finally {
        await releaseUserInflight(redis, userId, jobId);
      }
    },
    { concurrency },
  );

  worker.on('error', (e: any) => {
    // eslint-disable-next-line no-console
    console.error('BullMQ worker error:', e);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker error:', e);
  process.exit(1);
});

