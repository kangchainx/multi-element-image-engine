import { randomUUID } from 'crypto';

import { loadConfig } from '../lib/config.js';
import {
  claimNextQueuedJob,
  getJob,
  insertJobEvent,
  markJobCanceled,
  markJobCompleted,
  markJobFailed,
  openDb,
  replaceJobResults,
  requestCancel,
  setJobComfyPromptId,
  setJobProgress,
} from '../db/db.js';
import { getHistoryEntry, comfyWsUrl, submitWorkflow } from '../lib/comfy.js';
import { buildDualTrackWorkflow, loadBaseWorkflow, type DualTrackParams, type Workflow } from '../workflows/dual-track.js';
import { nowMs, sleep } from '../lib/utils.js';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);

function parseParamsJson(paramsJson: string | null): DualTrackParams {
  if (!paramsJson) return {};
  try {
    const v = JSON.parse(paramsJson);
    return (v && typeof v === 'object') ? (v as DualTrackParams) : {};
  } catch {
    return {};
  }
}

function startComfyProgressWs(opts: {
  comfyuiApiBase: string;
  clientId: string;
  promptId: string;
  workflow: Workflow;
  jobId: string;
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
        }
      } else if (msg.type === 'progress' && msg.data?.prompt_id === opts.promptId) {
        lastProgressAtRef.v = nowMs();
        const v = msg.data?.value;
        const m = msg.data?.max;
        if (typeof v === 'number' && typeof m === 'number') {
          const payload = { step: v, steps: m };
          opts.onProgress(payload);
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
    if (job?.cancel_requested) {
      throw new Error('canceled');
    }

    const elapsed = (nowMs() - startedAt) / 1000;
    if (elapsed > opts.timeoutSeconds) {
      throw new Error(`timeout after ${Math.trunc(elapsed)}s`);
    }

    const noProg = (nowMs() - opts.lastProgressAtRef.v) / 1000;
    if (noProg > opts.noProgressTimeoutSeconds) {
      throw new Error(`no progress for ${Math.trunc(noProg)}s`);
    }

    const h = await getHistoryEntry(opts.comfyuiApiBase, opts.promptId);
    if (h) return h;
    await sleep(1000);
  }
}

async function processJob(jobId: string, baseWorkflow: Workflow): Promise<void> {
  const row = getJob(db, jobId);
  if (!row) return;

  insertJobEvent(db, jobId, 'state', { state: 'running' });
  setJobProgress(db, jobId, { phase: 'running' });

  if (!row.ref_rel || !row.src_rels_json) {
    throw new Error('missing input file refs in DB');
  }
  const srcRels = JSON.parse(row.src_rels_json) as string[];
  const params = parseParamsJson(row.params_json);

  // Reasonable default for non-square source refs: avoid center-crop.
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

  const ws = startComfyProgressWs({
    comfyuiApiBase: cfg.comfyuiApiBase,
    clientId,
    promptId: submit.prompt_id,
    workflow,
    jobId,
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
}

async function main(): Promise<void> {
  const baseWorkflow = await loadBaseWorkflow();
  insertJobEvent(db, 'system', 'log', { message: 'worker started' });

  // Simple polling worker. For scale/outside sandbox, swap this with BullMQ.
  while (true) {
    const claimed = claimNextQueuedJob(db);
    if (!claimed) {
      await sleep(500);
      continue;
    }

    const jobId = claimed.job_id;
    try {
      await processJob(jobId, baseWorkflow);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'canceled') {
        markJobCanceled(db, jobId, 'canceled by user');
        insertJobEvent(db, jobId, 'state', { state: 'canceled' });
      } else {
        markJobFailed(db, jobId, msg);
        insertJobEvent(db, jobId, 'state', { state: 'failed' });
        insertJobEvent(db, jobId, 'error', { message: msg });
      }
    } finally {
      // If cancel was requested while running, ensure state is updated.
      const j = getJob(db, jobId);
      if (j?.cancel_requested && j.state === 'running') {
        requestCancel(db, jobId);
        markJobCanceled(db, jobId, 'canceled by user');
        insertJobEvent(db, jobId, 'state', { state: 'canceled' });
      }
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker error:', e);
  process.exit(1);
});
