import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export type MeieConfig = {
  comfyuiApiBase: string;
  comfyInputDir: string;
  uploadSubdir: string;
  outputDirPrefix: string;
  redisUrl: string;
  queueName: string;
  jobsPerDevice: number;
  workerMaxProcesses: number;
  workerTotalConcurrency?: number;
  workerProcesses?: number;
  workerConcurrencyPerProcess: number;
  host: string;
  port: number;
  maxUploadBytes: number;
  maxFiles: number;
  jobTimeoutSeconds: number;
  noProgressTimeoutSeconds: number;
  dbPath: string;
  corsOrigin: string;
};

function toInt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toMaybeInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function toFloat(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function truthy(v: string | undefined): boolean {
  if (!v) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v.trim().toLowerCase());
}

export function resolveComfyInputDir(): string {
  const explicit = process.env.COMFY_INPUT_DIR?.trim();
  if (explicit) return explicit;

  const comfyRoot = process.env.COMFY_ROOT?.trim();
  if (comfyRoot) return path.join(comfyRoot, 'input');

  const guess = path.join(os.homedir(), 'Documents', 'ComfyUI', 'input');
  if (fs.existsSync(guess)) return guess;

  throw new Error(
    `Cannot resolve ComfyUI input dir. Set COMFY_INPUT_DIR or COMFY_ROOT. Tried: ${guess}`,
  );
}

export function resolveDbPath(): string {
  const explicit = process.env.MEIE_DB_PATH?.trim();
  if (explicit) return explicit;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const pkgRoot = path.resolve(__dirname, '..', '..');
  return path.join(pkgRoot, 'data', 'meie.sqlite');
}

export function loadConfig(): MeieConfig {
  const comfyuiApiBase = (process.env.COMFYUI_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const comfyInputDir = resolveComfyInputDir();
  const uploadSubdir = (process.env.UPLOAD_SUBDIR || 'meie_uploads').trim();
  const outputDirPrefix = (process.env.OUTPUT_DIR_PREFIX || 'MEIE_RUNS').trim();

  const redisUrl = (process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim();
  const queueName = (process.env.QUEUE_NAME || 'meie:jobs').trim();
  const jobsPerDevice = toInt(process.env.JOBS_PER_DEVICE, 1);
  const workerMaxProcesses = toInt(process.env.WORKER_MAX_PROCESSES, 8);
  const workerTotalConcurrency = toMaybeInt(process.env.WORKER_TOTAL_CONCURRENCY);
  const workerProcesses = toMaybeInt(process.env.WORKER_PROCESSES);
  const workerConcurrencyPerProcess = toInt(process.env.WORKER_CONCURRENCY_PER_PROCESS, 1);

  const host = (process.env.HOST || '127.0.0.1').trim();
  const port = toInt(process.env.PORT, 8787);

  const maxUploadBytes = toInt(process.env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024);
  const maxFiles = toInt(process.env.MAX_FILES, 10);

  const jobTimeoutSeconds = toFloat(process.env.JOB_TIMEOUT_SECONDS, 7200);
  const noProgressTimeoutSeconds = toFloat(process.env.NO_PROGRESS_TIMEOUT_SECONDS, 900);

  const dbPath = resolveDbPath();
  const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();

  return {
    comfyuiApiBase,
    comfyInputDir,
    uploadSubdir,
    outputDirPrefix,
    redisUrl,
    queueName,
    jobsPerDevice,
    workerMaxProcesses,
    workerTotalConcurrency,
    workerProcesses,
    workerConcurrencyPerProcess,
    host,
    port,
    maxUploadBytes,
    maxFiles,
    jobTimeoutSeconds,
    noProgressTimeoutSeconds,
    dbPath,
    corsOrigin,
  };
}
