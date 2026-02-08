import cluster from 'node:cluster';
import os from 'os';

import { loadConfig } from '../lib/config.js';
import { getComfyDeviceCount } from '../lib/comfy.js';

function resolveCpuCount(): number {
  try {
    // Node 18.14+.
    const ap = (os as any).availableParallelism?.();
    if (typeof ap === 'number' && Number.isFinite(ap) && ap > 0) return Math.trunc(ap);
  } catch {
    // ignore
  }
  const n = os.cpus()?.length || 1;
  return n > 0 ? n : 1;
}

function toGiB(bytes: number): string {
  return `${(bytes / (1024 ** 3)).toFixed(1)}GiB`;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const isPrimary = (cluster as any).isPrimary ?? (cluster as any).isMaster;
  if (!isPrimary) {
    await import('./worker.js');
    return;
  }

  const cpu = resolveCpuCount();
  const maxByCpu = Math.max(1, cpu - 1);
  const mem = os.totalmem();
  const devices = await getComfyDeviceCount(cfg.comfyuiApiBase, 5000);

  const totalDefault = Math.max(1, devices * Math.max(1, cfg.jobsPerDevice));
  const totalTarget = Math.max(1, cfg.workerTotalConcurrency ?? Math.min(totalDefault, maxByCpu));

  const perProcConcurrency = Math.max(1, cfg.workerConcurrencyPerProcess || 1);
  const maxProcs = Math.max(1, Math.min(Math.max(1, cfg.workerMaxProcesses), maxByCpu));
  const procTarget = Math.ceil(totalTarget / perProcConcurrency);
  const processes = Math.max(1, Math.min(cfg.workerProcesses ?? procTarget, maxProcs));
  const effectiveTotal = processes * perProcConcurrency;

  // eslint-disable-next-line no-console
  console.log(
    [
      'MEIE worker master',
      `cpu=${cpu}`,
      `mem=${toGiB(mem)}`,
      `comfy_devices=${devices}`,
      `jobs_per_device=${cfg.jobsPerDevice}`,
      `target_total=${totalTarget}`,
      `processes=${processes}`,
      `per_proc_concurrency=${perProcConcurrency}`,
      `effective_total=${effectiveTotal}`,
      `redis=${cfg.redisUrl}`,
      `queue=${cfg.queueName}`,
    ].join(' '),
  );

  const desiredEnv = (idx: number) => ({
    ...process.env,
    WORKER_PROCESS_INDEX: String(idx),
    WORKER_CONCURRENCY: String(perProcConcurrency),
  });

  const idToIndex = new Map<number, number>();
  for (let i = 0; i < processes; i++) {
    const w = cluster.fork(desiredEnv(i));
    idToIndex.set(w.id, i);
  }

  cluster.on('exit', (worker, code, signal) => {
    const idx = idToIndex.get(worker.id);
    // eslint-disable-next-line no-console
    console.error(`worker exit pid=${worker.process.pid} idx=${idx ?? 'unknown'} code=${code} signal=${signal}`);

    const nextIdx = idx ?? 0;
    const w = cluster.fork(desiredEnv(nextIdx));
    idToIndex.set(w.id, nextIdx);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker master error:', e);
  process.exit(1);
});
