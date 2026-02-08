import { create } from 'zustand';
import {
  apiUrl,
  cancelJob as cancelJobApi,
  createJob,
  ensureFile,
  listJobs,
  type JobPublic,
  type JobState,
} from '../api/meie';

export type EngineJob = JobPublic & {
  // Client-side derived, monotonic.
  progressPct: number;
  resultImage: string | null;
  updated_at_ms: number;
};

export type EngineStatus = 'idle' | 'enqueueing';

export interface EngineState {
  // Draft inputs (left panel)
  referenceImage: File | string | null;
  sourceImages: File[];

  // Jobs (right panel + main canvas)
  jobs: EngineJob[];
  selectedJobId: string | null;

  status: EngineStatus;
  uiError: string | null;
  historyLoaded: boolean;

  // Actions
  setRefImage: (file: File | string | null) => void;
  addSourceImages: (files: File[]) => void;
  removeSourceImage: (index: number) => void;
  resetDraft: () => void;

  enqueueJob: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;

  loadHistory: () => Promise<void>;
  selectJob: (jobId: string | null) => void;
}

const ACTIVE_STATES: JobState[] = ['creating', 'queued', 'running'];
const DONE_STATES: JobState[] = ['completed', 'failed', 'canceled'];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function isActiveState(s: JobState): boolean {
  return (ACTIVE_STATES as string[]).includes(s);
}

function isDoneState(s: JobState): boolean {
  return (DONE_STATES as string[]).includes(s);
}

function progressFrom(job: JobPublic | null): number {
  if (!job) return 0;
  if (job.state === 'completed') return 100;
  if (job.state === 'failed' || job.state === 'canceled') return 0;

  const p = job.progress && typeof job.progress === 'object' ? job.progress : null;
  const phase = p && typeof (p as any).phase === 'string' ? String((p as any).phase) : '';

  // Prefer sampling progress if present.
  if (p && typeof (p as any).step === 'number' && typeof (p as any).steps === 'number' && (p as any).steps > 0) {
    const ratio = clamp((p as any).step / (p as any).steps, 0, 1);
    return Math.round(15 + ratio * 80); // 15..95
  }

  if (phase === 'executing') return 15;
  if (phase === 'submitted') return 12;
  if (phase === 'running') return 10;
  if (job.state === 'queued' || job.state === 'creating') return 5;
  return 8;
}

function firstResultUrl(job: JobPublic): string | null {
  const first = Array.isArray(job.images) ? job.images[0] : null;
  return first && typeof first.url === 'string' && first.url ? apiUrl(first.url) : null;
}

export const useEngineStore = create<EngineState>((set, get) => {
  const esByJob = new Map<string, EventSource>();

  const maxFiles = (() => {
    const raw = (import.meta as any).env?.VITE_MEIE_MAX_FILES;
    const n = typeof raw === 'string' ? Number(raw) : undefined;
    return Number.isFinite(n) && (n as number) > 0 ? Math.trunc(n as number) : 10;
  })();

  const maxUploadBytes = (() => {
    const raw = (import.meta as any).env?.VITE_MEIE_MAX_UPLOAD_BYTES;
    const n = typeof raw === 'string' ? Number(raw) : undefined;
    return Number.isFinite(n) && (n as number) > 0 ? Math.trunc(n as number) : 50 * 1024 * 1024;
  })();

  const closeEs = (jobId: string) => {
    const es = esByJob.get(jobId);
    if (!es) return;
    try {
      es.close();
    } catch {
      // ignore
    }
    esByJob.delete(jobId);
  };

  const upsertJob = (incoming: JobPublic) => {
    set((state) => {
      const now = Date.now();
      const idx = state.jobs.findIndex((j) => j.id === incoming.id);
      const prev = idx >= 0 ? state.jobs[idx] : null;
      const derivedPct = progressFrom(incoming);
      const nextPct = prev ? Math.max(prev.progressPct, derivedPct) : derivedPct;
      const next: EngineJob = {
        ...(prev || ({} as any)),
        ...incoming,
        progressPct: nextPct,
        resultImage: incoming.state === 'completed' ? firstResultUrl(incoming) : (prev?.resultImage ?? null),
        updated_at_ms: now,
      };

      const nextJobs = idx >= 0 ? state.jobs.map((j, i) => (i === idx ? next : j)) : [next, ...state.jobs];

      // Keep stable order: newest first by created_at.
      nextJobs.sort((a, b) => {
        const ta = typeof a.created_at === 'number' ? a.created_at : 0;
        const tb = typeof b.created_at === 'number' ? b.created_at : 0;
        return tb - ta;
      });

      return { jobs: nextJobs };
    });

    if (isDoneState(incoming.state)) {
      closeEs(incoming.id);
    }
  };

  const ensureSubscribed = (jobId: string) => {
    if (esByJob.has(jobId)) return;

    const es = new EventSource(apiUrl(`/v1/jobs/${encodeURIComponent(jobId)}/events`));
    esByJob.set(jobId, es);

    es.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const j = JSON.parse(String(e.data || '{}')) as JobPublic;
        if (j && typeof j.id === 'string') upsertJob(j);
      } catch {
        // ignore
      }
    });

    es.addEventListener('progress', (e: MessageEvent) => {
      // progress events are partial; we just bump the stored progressPct.
      try {
        const d = JSON.parse(String(e.data || '{}')) as any;
        if (d && typeof d === 'object' && typeof d.step === 'number' && typeof d.steps === 'number' && d.steps > 0) {
          const ratio = clamp(d.step / d.steps, 0, 1);
          const pct = Math.round(15 + ratio * 80);
          set((state) => {
            const idx = state.jobs.findIndex((j) => j.id === jobId);
            if (idx < 0) return {} as any;
            const prev = state.jobs[idx];
            const next = { ...prev, progressPct: Math.max(prev.progressPct, pct), updated_at_ms: Date.now() };
            const nextJobs = state.jobs.map((j, i) => (i === idx ? next : j));
            return { jobs: nextJobs };
          });
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('completed', (e: MessageEvent) => {
      try {
        const j = JSON.parse(String(e.data || '{}')) as JobPublic;
        if (j && typeof j.id === 'string') upsertJob(j);
      } catch {
        // ignore
      }
    });

    es.addEventListener('failed', (e: MessageEvent) => {
      try {
        const d = JSON.parse(String(e.data || '{}')) as any;
        const msg = d && d.message ? String(d.message) : '任务执行失败';
        set((state) => {
          const idx = state.jobs.findIndex((j) => j.id === jobId);
          if (idx < 0) return {} as any;
          const prev = state.jobs[idx];
          const next: EngineJob = {
            ...prev,
            state: 'failed',
            error: msg,
            progressPct: prev.progressPct,
            updated_at_ms: Date.now(),
          } as any;
          const nextJobs = state.jobs.map((j, i) => (i === idx ? next : j));
          return { jobs: nextJobs };
        });
      } catch {
        // ignore
      }
      closeEs(jobId);
    });

    es.onerror = () => {
      // EventSource will retry automatically; we keep local state.
    };
  };

  const countActive = () => get().jobs.filter((j) => isActiveState(j.state)).length;

  return {
    referenceImage: null,
    sourceImages: [],
    jobs: [],
    selectedJobId: null,
    status: 'idle',
    uiError: null,
    historyLoaded: false,

    setRefImage: (file) => set({ referenceImage: file }),

    addSourceImages: (files) => set((state) => ({ sourceImages: [...state.sourceImages, ...files] })),

    removeSourceImage: (index) =>
      set((state) => ({ sourceImages: state.sourceImages.filter((_, i) => i !== index) })),

    resetDraft: () => set({ referenceImage: null, sourceImages: [], uiError: null }),

    selectJob: (jobId) => set({ selectedJobId: jobId }),

    loadHistory: async () => {
      if (get().historyLoaded) return;
      set({ uiError: null });
      try {
        const rows = await listJobs({ limit: 100 });
        for (const j of rows) {
          if (j && typeof j.id === 'string') upsertJob(j);
        }
        // Subscribe to active jobs (max 3 by API limit).
        const active = rows.filter((j) => j && isActiveState(j.state));
        for (const j of active) ensureSubscribed(j.id);

        set({ historyLoaded: true });
      } catch (e) {
        set({ uiError: e instanceof Error ? e.message : String(e), historyLoaded: true });
      }
    },

    enqueueJob: async () => {
      const ref = get().referenceImage;
      const sources = get().sourceImages;

      set({ uiError: null });

      if (!ref || sources.length < 1) {
        set({ uiError: '请先上传参考图和至少 1 张素材图' });
        return;
      }

      if (countActive() >= 3) {
        set({ uiError: '最多同时排队/运行 3 个任务，请等待其中一个完成后再创建。' });
        return;
      }

      if (1 + sources.length > maxFiles) {
        set({ uiError: `文件数量超限：参考图(1) + 素材图(${sources.length}) > MAX_FILES=${maxFiles}` });
        return;
      }

      set({ status: 'enqueueing' });
      try {
        const refFile = await ensureFile(ref, 'ref.png');
        const totalBytes = refFile.size + sources.reduce((sum, f) => sum + (f?.size || 0), 0);
        if (totalBytes > maxUploadBytes) {
          set({
            status: 'idle',
            uiError: `上传总大小超限：${(totalBytes / (1024 * 1024)).toFixed(1)}MB > MAX_UPLOAD_BYTES=${(
              maxUploadBytes /
              (1024 * 1024)
            ).toFixed(0)}MB`,
          });
          return;
        }

        const created = await createJob({ ref: refFile, sources });

        // Insert a local placeholder immediately; SSE snapshot will refresh it.
        const placeholder: JobPublic = {
          id: created.jobId,
          user_id: '',
          state: 'queued',
          created_at: Date.now(),
          started_at: null,
          finished_at: null,
          comfy_prompt_id: null,
          error: null,
          progress: { phase: 'queued' },
          images: [],
        };
        upsertJob(placeholder);
        set({ selectedJobId: created.jobId });
        ensureSubscribed(created.jobId);

        // Reset inputs so user can create the next job immediately.
        set({ referenceImage: null, sourceImages: [], status: 'idle' });
      } catch (e) {
        set({ status: 'idle', uiError: e instanceof Error ? e.message : String(e) });
      }
    },

    cancelJob: async (jobId: string) => {
      set({ uiError: null });
      try {
        await cancelJobApi(jobId);
      } catch (e) {
        set({ uiError: e instanceof Error ? e.message : String(e) });
      }
      closeEs(jobId);
      // Refresh snapshot.
      try {
        const rows = await listJobs({ limit: 100 });
        for (const j of rows) {
          if (j && typeof j.id === 'string') upsertJob(j);
        }
      } catch {
        // ignore
      }
    },
  };
});
