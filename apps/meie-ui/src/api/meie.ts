export type JobState = 'creating' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export type JobImage = { idx: number; url: string };

export type JobPublic = {
  id: string;
  user_id: string;
  state: JobState;
  created_at?: string | number | null;
  started_at?: string | number | null;
  finished_at?: string | number | null;
  comfy_prompt_id?: string | null;
  error?: string | null;
  progress: any | null;
  images: JobImage[];
};

const USER_ID_KEY = 'meie.user_id';

export function getOrCreateUserId(): string {
  const gen = () => {
    try {
      if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    } catch {
      // ignore
    }
    // Fallback (not RFC4122, but stable-enough for local dev).
    return `meie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };
  try {
    const existing = localStorage.getItem(USER_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
    const id = gen();
    localStorage.setItem(USER_ID_KEY, id);
    return id;
  } catch {
    // If storage is unavailable, fall back to an ephemeral ID for this session.
    return gen();
  }
}

export function apiBase(): string {
  // Vite: expose as VITE_MEIE_API_BASE. Default keeps everything same-origin in dev via Vite proxy.
  const v = (import.meta as any).env?.VITE_MEIE_API_BASE;
  const base = (typeof v === 'string' && v.trim()) ? v.trim() : '/api';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

export function apiUrl(pathname: string): string {
  const base = apiBase();
  if (!pathname) return base;
  return `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}

async function readJsonOrText(r: Response): Promise<{ json: any | null; text: string }> {
  const text = await r.text();
  if (!text) return { json: null, text: '' };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

export async function createJob(opts: {
  ref: File;
  sources: File[];
  params?: Record<string, any>;
  debug?: boolean;
}): Promise<{ jobId: string }> {
  const fd = new FormData();
  fd.append('ref', opts.ref);
  for (const s of opts.sources) fd.append('sources', s);
  if (opts.params) fd.append('params', JSON.stringify(opts.params));
  if (opts.debug) fd.append('debug', '1');

  const r = await fetch(apiUrl('/v1/jobs'), {
    method: 'POST',
    headers: { 'X-User-Id': getOrCreateUserId() },
    body: fd,
  });

  const { json, text } = await readJsonOrText(r);
  if (!r.ok) {
    const msg = (json && (json.message || json.error)) ? String(json.message || json.error) : (text || `HTTP ${r.status}`);
    throw new Error(msg);
  }
  if (!json || typeof json.jobId !== 'string') throw new Error('invalid response: missing jobId');
  return { jobId: json.jobId };
}

export async function getJob(jobId: string): Promise<JobPublic> {
  const r = await fetch(apiUrl(`/v1/jobs/${encodeURIComponent(jobId)}`), { method: 'GET' });
  const { json, text } = await readJsonOrText(r);
  if (!r.ok) throw new Error((json && (json.message || json.error)) ? String(json.message || json.error) : (text || `HTTP ${r.status}`));
  return json as JobPublic;
}

export async function listJobs(opts?: { state?: string; limit?: number }): Promise<JobPublic[]> {
  const qs = new URLSearchParams();
  if (opts?.state) qs.set('state', String(opts.state));
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) qs.set('limit', String(Math.trunc(opts.limit)));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const r = await fetch(apiUrl(`/v1/jobs${suffix}`), {
    method: 'GET',
    headers: { 'X-User-Id': getOrCreateUserId() },
  });
  const { json, text } = await readJsonOrText(r);
  if (!r.ok) throw new Error((json && (json.message || json.error)) ? String(json.message || json.error) : (text || `HTTP ${r.status}`));
  if (!Array.isArray(json)) throw new Error('invalid response: expected array');
  return json as JobPublic[];
}

export async function cancelJob(jobId: string): Promise<any> {
  const r = await fetch(apiUrl(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`), { method: 'POST' });
  const { json, text } = await readJsonOrText(r);
  if (!r.ok) throw new Error((json && (json.message || json.error)) ? String(json.message || json.error) : (text || `HTTP ${r.status}`));
  return json;
}

export async function ensureFile(v: File | string, name: string): Promise<File> {
  if (v instanceof File) return v;
  const r = await fetch(v);
  if (!r.ok) throw new Error(`failed to fetch image: HTTP ${r.status}`);
  const blob = await r.blob();
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}
