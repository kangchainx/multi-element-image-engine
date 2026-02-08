import { randomUUID } from 'crypto';

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
import { getHistoryEntry, comfyWsUrl, submitWorkflow } from '../lib/comfy.js';
import { buildDualTrackWorkflow, loadBaseWorkflow, type DualTrackParams, type Workflow } from '../workflows/dual-track.js';
import { nowMs, sleep } from '../lib/utils.js';
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
    return { close: () => {}, lastProgressAtRef };
  }

  let closed = false;
  let lastExecKey = '';
  let lastProgressLogAt = 0;

  try {
    const ws = new WS(url);

    ws.onopen = () => {
      insertJobEvent(db, opts.jobId, 'log', { message: `ws connected: ${url}` });
    };
    ws.onerror = () => {
      if (!closed) insertJobEvent(db, opts.jobId, 'log', { message: 'ws error' });
    };
    ws.onclose = () => {
      if (!closed) insertJobEvent(db, opts.jobId, 'log', { message: 'ws closed' });
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
          }
        }
      } else if (msg.type === 'execution_error' && msg.data?.prompt_id === opts.promptId) {
        lastProgressAtRef.v = nowMs();
        opts.onError({ type: 'execution_error', data: msg.data });
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
  while (true) {
    // Cancel?
    const job = getJob(db, opts.jobId);
    if (job?.cancel_requested) throw new Error('canceled');

    const elapsed = (nowMs() - startedAt) / 1000;
    if (elapsed > opts.timeoutSeconds) throw new Error(`timeout after ${Math.trunc(elapsed)}s`);

    const noProg = (nowMs() - opts.lastProgressAtRef.v) / 1000;
    if (noProg > opts.noProgressTimeoutSeconds) throw new Error(`no progress for ${Math.trunc(noProg)}s`);

    const h = await getHistoryEntry(opts.comfyuiApiBase, opts.promptId);
    if (h) return h;
    await sleep(1000);
  }
}

async function processJob(jobId: string, bullJob: any, baseWorkflow: Workflow): Promise<void> {
  const row = getJob(db, jobId);
  if (!row) throw new Error('job not found');

  if (!row.ref_rel || !row.src_rels_json) throw new Error('missing input file refs in DB');

  markJobRunning(db, jobId);
  insertJobEvent(db, jobId, 'state', { state: 'running' });
  setJobProgress(db, jobId, { phase: 'running' });
  safeUpdateProgress(bullJob, { phase: 'running', ts: Date.now() });

  const srcRels = JSON.parse(row.src_rels_json) as string[];
  const params = parseParamsJson(row.params_json);
  if (!params.ipadapter_crop_position) params.ipadapter_crop_position = 'pad';

  const workflow = buildDualTrackWorkflow({
    base: baseWorkflow,
    jobId,
    outputDirPrefix: cfg.outputDirPrefix,
    refRel: row.ref_rel,
    srcRels,
    params,
    debug: Boolean(row.debug),
  });

  // Submit to ComfyUI.
  const clientId = randomUUID();
  insertJobEvent(db, jobId, 'log', { message: `submitting to ComfyUI (${cfg.comfyuiApiBase})` });
  const submit = await submitWorkflow(cfg.comfyuiApiBase, workflow, clientId);
  setJobComfyPromptId(db, jobId, submit.prompt_id);
  insertJobEvent(db, jobId, 'log', { message: `submitted prompt_id=${submit.prompt_id} queue=${submit.number}` });
  safeUpdateProgress(bullJob, { phase: 'submitted', promptId: submit.prompt_id, queue: submit.number, ts: Date.now() });

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

  const outputs = (history?.outputs || {}) as Record<string, any>;
  const finalImgs = Array.isArray(outputs?.['7']?.images) ? (outputs['7'].images as any[]) : [];
  const otherImgs: any[] = [];
  for (const [nodeId, nodeOut] of Object.entries(outputs)) {
    if (nodeId === '7') continue; // keep final first
    for (const img of (nodeOut as any)?.images || []) otherImgs.push(img);
  }
  const imgs = [...finalImgs, ...otherImgs];
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
}

async function main(): Promise<void> {
  const baseWorkflow = await loadBaseWorkflow();
  const concurrency = Number(process.env.WORKER_CONCURRENCY || cfg.workerConcurrencyPerProcess || 1);
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

