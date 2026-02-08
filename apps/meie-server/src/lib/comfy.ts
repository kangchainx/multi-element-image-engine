import { Workflow } from '../workflows/dual-track.js';

export type SubmitResponse = {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, any>;
};

export type ImageOutput = { filename: string; subfolder: string; type: string };
export type NodeOutput = { images?: ImageOutput[] };
export type HistoryData = { outputs: Record<string, NodeOutput>; status?: { completed?: boolean; messages?: any[] } };
export type SystemStats = { devices?: any[] };
export type ObjectInfo = Record<string, any>;

function toWsBase(httpBase: string): string {
  const u = new URL(httpBase);
  if (u.protocol === 'http:') u.protocol = 'ws:';
  else if (u.protocol === 'https:') u.protocol = 'wss:';
  return u.toString().replace(/\/$/, '');
}

export function comfyWsUrl(comfyuiApiBase: string, clientId: string): string {
  return `${toWsBase(comfyuiApiBase)}/ws?clientId=${encodeURIComponent(clientId)}`;
}

export async function submitWorkflow(
  comfyuiApiBase: string,
  workflow: Workflow,
  clientId: string,
): Promise<SubmitResponse> {
  const r = await fetch(`${comfyuiApiBase}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ComfyUI /prompt failed (${r.status}): ${text}`);
  const json = JSON.parse(text) as SubmitResponse;
  if (json.node_errors && Object.keys(json.node_errors).length > 0) {
    throw new Error(`Workflow validation failed: ${JSON.stringify(json.node_errors)}`);
  }
  return json;
}

export async function getHistoryEntry(comfyuiApiBase: string, promptId: string): Promise<HistoryData | null> {
  const r = await fetch(`${comfyuiApiBase}/history/${promptId}`);
  if (!r.ok) throw new Error(`ComfyUI /history failed (${r.status})`);
  const json = (await r.json()) as any;
  if (json?.outputs) return json as HistoryData;
  if (json?.[promptId]) return json[promptId] as HistoryData;
  return null;
}

export async function getSystemStats(comfyuiApiBase: string, timeoutMs = 5000): Promise<SystemStats | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${comfyuiApiBase}/system_stats`, { signal: ac.signal });
    if (!r.ok) return null;
    return (await r.json()) as SystemStats;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function getObjectInfo(comfyuiApiBase: string, timeoutMs = 5000): Promise<ObjectInfo | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${comfyuiApiBase}/object_info`, { signal: ac.signal });
    if (!r.ok) return null;
    const json = (await r.json()) as any;
    return json && typeof json === 'object' ? (json as ObjectInfo) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function listWorkflowNodeTypes(workflow: Workflow): string[] {
  const set = new Set<string>();
  for (const n of Object.values(workflow || {})) {
    const t = (n as any)?.class_type;
    if (typeof t === 'string' && t.trim()) set.add(t.trim());
  }
  return Array.from(set).sort();
}

export async function getComfyDeviceCount(comfyuiApiBase: string, timeoutMs = 5000): Promise<number> {
  const s = await getSystemStats(comfyuiApiBase, timeoutMs);
  const n = Array.isArray(s?.devices) ? s!.devices!.length : 0;
  return n > 0 ? n : 1;
}

export function flattenImages(h: HistoryData): ImageOutput[] {
  const out: ImageOutput[] = [];
  for (const node of Object.values(h.outputs || {})) {
    for (const img of node.images || []) out.push(img);
  }
  return out;
}
