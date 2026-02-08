import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  console.log(
    [
      'ComfyUI smoke test',
      '',
      'Usage:',
      '  node apps/meie-server/scripts/comfy-smoke.mjs [--base http://127.0.0.1:8000] [--workflow <path>]',
      '    [--ref <relpath>] [--src <relpath>] [--srcs a.png,b.png] [--require A,B,C]',
      '',
      'Env:',
      '  COMFYUI_API_BASE    default base URL if --base not provided',
      '  COMFY_INPUT_DIR     optional; if set, script will warn if ref/src files are missing on disk',
      '',
      'Exit codes:',
      '  0 success',
      '  1 failure (endpoint unreachable, missing node types, or /prompt rejected)',
    ].join('\n'),
  );
}

function argValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  return argv[idx + 1] ?? null;
}

function splitCsv(v) {
  const s = String(v || '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function toBaseUrl(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function fetchJson(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    return { ok: r.ok, status: r.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

function repoRoot() {
  // apps/meie-server/scripts -> apps/meie-server -> apps -> repo root
  return path.resolve(__dirname, '..', '..', '..');
}

function defaultWorkflowPath() {
  return path.resolve(repoRoot(), 'workflow_api.json');
}

function loadWorkflow(p) {
  const text = fs.readFileSync(p, 'utf-8');
  return JSON.parse(text);
}

function listNodeTypes(workflow) {
  const types = new Set();
  for (const n of Object.values(workflow || {})) {
    const t = n && typeof n === 'object' ? n.class_type : null;
    if (typeof t === 'string' && t.trim()) types.add(t.trim());
  }
  return Array.from(types).sort();
}

function patchInputImages(workflow, opts) {
  // These node ids are what our repo workflow_api.json uses.
  const REF_NODE_ID = '10';
  const SRC_NODE_ID = '20';

  if (opts.ref && workflow?.[REF_NODE_ID]?.inputs) {
    workflow[REF_NODE_ID].inputs.image = opts.ref;
  }
  if (opts.src && workflow?.[SRC_NODE_ID]?.inputs) {
    workflow[SRC_NODE_ID].inputs.image = opts.src;
  }
  // Note: multi-src chaining isn't handled here; this is a minimal validation helper.
  return workflow;
}

function warnIfMissingOnDisk(relPaths) {
  const inputDir = String(process.env.COMFY_INPUT_DIR || '').trim();
  if (!inputDir) return;
  for (const rel of relPaths) {
    if (!rel) continue;
    const abs = path.join(inputDir, rel);
    if (!fs.existsSync(abs)) {
      console.warn(`[smoke] WARN: input missing on disk: ${abs}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exitCode = 0;
    return;
  }

  const base =
    toBaseUrl(argValue(argv, '--base')) ||
    toBaseUrl(process.env.COMFYUI_API_BASE) ||
    'http://127.0.0.1:8000';

  const workflowPath = argValue(argv, '--workflow') || defaultWorkflowPath();
  const requireCsv = argValue(argv, '--require');
  const requiredTypes = requireCsv
    ? requireCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const ref = argValue(argv, '--ref');
  const src = argValue(argv, '--src');
  const srcs = splitCsv(argValue(argv, '--srcs'));

  console.log(`[smoke] base=${base}`);
  console.log(`[smoke] workflow=${workflowPath}`);
  if (ref) console.log(`[smoke] ref=${ref}`);
  if (src) console.log(`[smoke] src=${src}`);
  if (srcs.length > 0) console.log(`[smoke] srcs=${srcs.join(',')}`);

  // 1) Reachability checks.
  const root = await fetchJson(`${base}/`, { method: 'GET' });
  if (!root.ok) {
    console.error(`[smoke] FAIL: GET / (status=${root.status}) ${root.text.slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  console.log('[smoke] ok: GET /');

  const obj = await fetchJson(`${base}/object_info`, { method: 'GET' });
  if (!obj.ok || !obj.json || typeof obj.json !== 'object') {
    console.error(`[smoke] FAIL: GET /object_info (status=${obj.status}) ${obj.text.slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  console.log('[smoke] ok: GET /object_info');

  // 2) Node type availability checks.
  let workflow = null;
  try {
    workflow = loadWorkflow(workflowPath);
  } catch (e) {
    console.error(`[smoke] FAIL: cannot read workflow: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  workflow = patchInputImages(workflow, { ref, src });
  // Best-effort filesystem warning (does not fail the run).
  warnIfMissingOnDisk([
    ref || workflow?.['10']?.inputs?.image,
    src || workflow?.['20']?.inputs?.image,
    ...srcs,
  ]);

  const types = listNodeTypes(workflow);
  const missingFromWorkflow = types.filter((t) => !(t in obj.json));
  if (missingFromWorkflow.length > 0) {
    console.error('[smoke] FAIL: ComfyUI missing node types referenced by workflow_api.json:');
    for (const t of missingFromWorkflow) console.error(`  - ${t}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[smoke] ok: all workflow node types available (${types.length})`);

  const missingRequired = requiredTypes.filter((t) => !(t in obj.json));
  if (missingRequired.length > 0) {
    console.error('[smoke] FAIL: ComfyUI missing required node types:');
    for (const t of missingRequired) console.error(`  - ${t}`);
    process.exitCode = 1;
    return;
  }

  // 3) Validate /prompt accepts our workflow (this is where missing_node_type showed up previously).
  const clientId = randomUUID();
  const submit = await fetchJson(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!submit.ok) {
    // Prefer printing JSON error if present.
    const err = submit.json || submit.text;
    console.error(`[smoke] FAIL: POST /prompt rejected (status=${submit.status})`);
    console.error(typeof err === 'string' ? err.slice(0, 2000) : JSON.stringify(err, null, 2));
    console.error(
      [
        '[smoke] Tip: LoadImage nodes validate that referenced files exist under ComfyUI input dir.',
        '  Either copy the referenced filenames into COMFY_INPUT_DIR,',
        '  or pass overrides: --ref <file> --src <file> to point at existing files.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  console.log('[smoke] ok: POST /prompt accepted');
  if (submit.json?.prompt_id) console.log(`[smoke] prompt_id=${submit.json.prompt_id}`);
  process.exitCode = 0;
}

main().catch((e) => {
  console.error(`[smoke] FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
