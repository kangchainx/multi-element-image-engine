import { readFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { access } from 'fs/promises';

// --- Config ---

const COMFYUI_API_BASE = process.env.COMFYUI_API_BASE || 'http://127.0.0.1:8000';
const CLIENT_ID = randomUUID();
const POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_WAIT_SECONDS = 3600; // SDXL + ControlNet + IPAdapter on MPS can easily exceed 10 minutes.
const PREFLIGHT_TIMEOUT_MS = 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_FILE_PATH = path.resolve(PKG_ROOT, '../../workflow_api.json');
const COMFY_INPUT_DIR = process.env.COMFY_INPUT_DIR || '/Users/chris/Documents/ComfyUI/input';

// Defaults tuned for quick iteration on Mac MPS.
const FAST_DEFAULT = process.env.FAST ? truthy(process.env.FAST) : true;
const FAST_WIDTH = 768;
const FAST_HEIGHT = 1376;
const FAST_STEPS = 8;
const FAST_CFG = 5.5;
const OUTPUT_DIR_PREFIX = process.env.OUTPUT_DIR_PREFIX || 'MEIE_RUNS';

// --- Types ---

interface WorkflowNode {
  inputs: Record<string, any>;
  class_type: string;
  _meta?: {
    title: string;
  };
  pos?: [number, number];
}

interface Workflow {
  [nodeId: string]: WorkflowNode;
}

interface SubmitResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, any>;
}

interface ImageOutput {
  filename: string;
  subfolder: string;
  type: string;
}

interface NodeOutput {
  images?: ImageOutput[];
}

interface HistoryData {
  outputs: Record<string, NodeOutput>;
  status?: {
    completed?: boolean;
    messages?: any[];
  };
}

// --- Helpers ---

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v.toLowerCase().trim());
}

function toWsBase(httpBase: string): string {
  const u = new URL(httpBase);
  if (u.protocol === 'http:') u.protocol = 'ws:';
  else if (u.protocol === 'https:') u.protocol = 'wss:';
  return u.toString().replace(/\/$/, '');
}

async function fetchJson(url: string, timeoutMs = PREFLIGHT_TIMEOUT_MS): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

async function fetchTextHead(url: string, timeoutMs = PREFLIGHT_TIMEOUT_MS, maxChars = 200): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, maxChars)}`);
    return text.slice(0, maxChars);
  } finally {
    clearTimeout(t);
  }
}

async function loadWorkflow(): Promise<Workflow> {
  const fileContent = await readFile(WORKFLOW_FILE_PATH, 'utf-8');
  return JSON.parse(fileContent) as Workflow;
}

function findNodeIdByTitle(workflow: Workflow, title: string, classType?: string): string | null {
  const hits: string[] = [];
  for (const [id, node] of Object.entries(workflow || {})) {
    if (!node || typeof node !== 'object') continue;
    const t = node?._meta?.title;
    if (t !== title) continue;
    if (classType && node.class_type !== classType) continue;
    hits.push(id);
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    hits.sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
    return hits[0];
  }
  return null;
}

function applyOverrides(workflow: Workflow): Workflow {
  // Prefer resolving by _meta.title, and fall back to historical numeric ids.
  const POS_NODE_ID = findNodeIdByTitle(workflow, 'POS_PROMPT', 'CLIPTextEncode') || '2';
  const NEG_NODE_ID = findNodeIdByTitle(workflow, 'NEG_PROMPT', 'CLIPTextEncode') || '3';
  const KSAMPLER_NODE_ID = findNodeIdByTitle(workflow, 'KSampler', 'KSampler') || '5';
  const EMPTY_LATENT_NODE_ID = findNodeIdByTitle(workflow, 'Empty Latent (768x1376)', 'EmptyLatentImage') || '4';
  const REF_IMAGE_NODE_ID = findNodeIdByTitle(workflow, 'REF_COMPOSITION', 'LoadImage') || '10';
  const SRC_IMAGE_NODE_ID = findNodeIdByTitle(workflow, 'SRC_FEATURE_STYLE', 'LoadImage') || '20';
  const CLIP_VISION_LOADER_NODE_ID = findNodeIdByTitle(workflow, 'CLIPVisionLoader', 'CLIPVisionLoader') || '21';
  const IPADAPTER_MODEL_LOADER_NODE_ID = findNodeIdByTitle(workflow, 'IPAdapterModelLoader', 'IPAdapterModelLoader') || '22';
  const CANNY_NODE_ID = findNodeIdByTitle(workflow, 'Canny Preprocessor', 'Canny') || '11';
  const CONTROLNET_APPLY_NODE_ID = findNodeIdByTitle(workflow, 'ControlNetApply (Track A)', 'ControlNetApplyAdvanced') || '13';
  const IPADAPTER_ADV_NODE_ID = findNodeIdByTitle(workflow, 'IPAdapterAdvanced (Track B)', 'IPAdapterAdvanced') || '23';

  const ipaCropPosition = process.env.IPADAPTER_CROP_POSITION; // e.g. "pad" to avoid center-crop
  const ipaInterpolation = process.env.IPADAPTER_INTERPOLATION || 'LANCZOS';
  const ipaSharpeningEnv = process.env.IPADAPTER_SHARPENING ? Number(process.env.IPADAPTER_SHARPENING) : undefined;
  const ipaSharpening = typeof ipaSharpeningEnv === 'number' && !Number.isNaN(ipaSharpeningEnv) ? ipaSharpeningEnv : 0.0;

  const maybePrepForClipVision = (imageRef: [string, number], title: string): [string, number] => {
    if (!ipaCropPosition) return imageRef;
    const prepId = nextNumericNodeId(workflow);
    workflow[prepId] = {
      class_type: 'PrepImageForClipVision',
      inputs: {
        image: imageRef,
        interpolation: ipaInterpolation,
        crop_position: ipaCropPosition,
        sharpening: ipaSharpening,
      },
      _meta: { title },
    };
    return [prepId, 0];
  };

  const srcImagesCsv = (process.env.SRC_IMAGES || '').trim();
  const srcImages = srcImagesCsv
    ? srcImagesCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const ipadapterWeightsList = (process.env.IPADAPTER_WEIGHTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ipadapterWeightTypesList = (process.env.IPADAPTER_WEIGHT_TYPES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ipadapterStartsList = (process.env.IPADAPTER_STARTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ipadapterEndsList = (process.env.IPADAPTER_ENDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const positive = process.env.POSITIVE_PROMPT;
  if (positive && workflow[POS_NODE_ID]?.inputs) {
    workflow[POS_NODE_ID].inputs.text = positive;
  }

  const negative = process.env.NEGATIVE_PROMPT;
  if (negative && workflow[NEG_NODE_ID]?.inputs) {
    workflow[NEG_NODE_ID].inputs.text = negative;
  }

  // Default: random seed unless explicitly pinned.
  const seedEnv = process.env.SEED;
  const seed = seedEnv ? Number(seedEnv) : Math.floor(Math.random() * 2 ** 31);
  if (!Number.isNaN(seed) && workflow[KSAMPLER_NODE_ID]?.inputs) {
    workflow[KSAMPLER_NODE_ID].inputs.seed = seed;
  }

  // Input image filenames (ComfyUI reads from its input directory).
  const refImage = process.env.REF_IMAGE;
  if (refImage && workflow[REF_IMAGE_NODE_ID]?.inputs) {
    workflow[REF_IMAGE_NODE_ID].inputs.image = refImage;
  }
  const srcImage = process.env.SRC_IMAGE;
  if (workflow[SRC_IMAGE_NODE_ID]?.inputs) {
    if (srcImages.length > 0) workflow[SRC_IMAGE_NODE_ID].inputs.image = srcImages[0];
    else if (srcImage) workflow[SRC_IMAGE_NODE_ID].inputs.image = srcImage;
  }

  // Optional: keep full (non-square) references by padding instead of center-cropping.
  if (ipaCropPosition && workflow[IPADAPTER_ADV_NODE_ID]?.inputs) {
    const baseImageRef: [string, number] = [SRC_IMAGE_NODE_ID, 0];
    workflow[IPADAPTER_ADV_NODE_ID].inputs.image = maybePrepForClipVision(baseImageRef, 'Prep SRC_1 for ClipVision');
  }

  // Track A: Canny thresholds + ControlNet strength window.
  const cannyLowEnv = process.env.CANNY_LOW ? Number(process.env.CANNY_LOW) : undefined;
  const cannyHighEnv = process.env.CANNY_HIGH ? Number(process.env.CANNY_HIGH) : undefined;
  if (workflow[CANNY_NODE_ID]?.inputs) {
    if (typeof cannyLowEnv === 'number' && !Number.isNaN(cannyLowEnv)) workflow[CANNY_NODE_ID].inputs.low_threshold = cannyLowEnv;
    if (typeof cannyHighEnv === 'number' && !Number.isNaN(cannyHighEnv)) workflow[CANNY_NODE_ID].inputs.high_threshold = cannyHighEnv;
  }

  const cnStrengthEnv = process.env.CONTROLNET_STRENGTH ? Number(process.env.CONTROLNET_STRENGTH) : undefined;
  const cnStartEnv = process.env.CONTROLNET_START ? Number(process.env.CONTROLNET_START) : undefined;
  const cnEndEnv = process.env.CONTROLNET_END ? Number(process.env.CONTROLNET_END) : undefined;
  if (workflow[CONTROLNET_APPLY_NODE_ID]?.inputs) {
    if (typeof cnStrengthEnv === 'number' && !Number.isNaN(cnStrengthEnv)) workflow[CONTROLNET_APPLY_NODE_ID].inputs.strength = cnStrengthEnv;
    if (typeof cnStartEnv === 'number' && !Number.isNaN(cnStartEnv)) workflow[CONTROLNET_APPLY_NODE_ID].inputs.start_percent = cnStartEnv;
    if (typeof cnEndEnv === 'number' && !Number.isNaN(cnEndEnv)) workflow[CONTROLNET_APPLY_NODE_ID].inputs.end_percent = cnEndEnv;
  }

  // Track B: IPAdapter weight window.
  const ipaWeightEnv = process.env.IPADAPTER_WEIGHT ? Number(process.env.IPADAPTER_WEIGHT) : undefined;
  const ipaWeightTypeEnv = process.env.IPADAPTER_WEIGHT_TYPE;
  const ipaCombineEmbedsEnv = process.env.IPADAPTER_COMBINE_EMBEDS;
  const ipaEmbedsScalingEnv = process.env.IPADAPTER_EMBEDS_SCALING;
  const ipaStartEnv = process.env.IPADAPTER_START ? Number(process.env.IPADAPTER_START) : undefined;
  const ipaEndEnv = process.env.IPADAPTER_END ? Number(process.env.IPADAPTER_END) : undefined;
  if (workflow[IPADAPTER_ADV_NODE_ID]?.inputs) {
    const weight0 = ipadapterWeightsList.length > 0 ? Number(ipadapterWeightsList[0]) : undefined;
    if (typeof weight0 === 'number' && !Number.isNaN(weight0)) workflow[IPADAPTER_ADV_NODE_ID].inputs.weight = weight0;
    else if (typeof ipaWeightEnv === 'number' && !Number.isNaN(ipaWeightEnv)) workflow[IPADAPTER_ADV_NODE_ID].inputs.weight = ipaWeightEnv;

    const weightType0 = ipadapterWeightTypesList.length > 0 ? ipadapterWeightTypesList[0] : undefined;
    if (weightType0) workflow[IPADAPTER_ADV_NODE_ID].inputs.weight_type = weightType0;
    else if (ipaWeightTypeEnv) workflow[IPADAPTER_ADV_NODE_ID].inputs.weight_type = ipaWeightTypeEnv;

    if (ipaCombineEmbedsEnv) workflow[IPADAPTER_ADV_NODE_ID].inputs.combine_embeds = ipaCombineEmbedsEnv;
    if (ipaEmbedsScalingEnv) workflow[IPADAPTER_ADV_NODE_ID].inputs.embeds_scaling = ipaEmbedsScalingEnv;

    const start0 = ipadapterStartsList.length > 0 ? Number(ipadapterStartsList[0]) : undefined;
    const end0 = ipadapterEndsList.length > 0 ? Number(ipadapterEndsList[0]) : undefined;
    if (typeof start0 === 'number' && !Number.isNaN(start0)) workflow[IPADAPTER_ADV_NODE_ID].inputs.start_at = start0;
    else if (typeof ipaStartEnv === 'number' && !Number.isNaN(ipaStartEnv)) workflow[IPADAPTER_ADV_NODE_ID].inputs.start_at = ipaStartEnv;
    if (typeof end0 === 'number' && !Number.isNaN(end0)) workflow[IPADAPTER_ADV_NODE_ID].inputs.end_at = end0;
    else if (typeof ipaEndEnv === 'number' && !Number.isNaN(ipaEndEnv)) workflow[IPADAPTER_ADV_NODE_ID].inputs.end_at = ipaEndEnv;
  }

  // Optional: multi-reference source set. We chain IPAdapterAdvanced nodes, one per source image.
  if (srcImages.length > 1) {
    let prevIpaNodeId = IPADAPTER_ADV_NODE_ID;

    for (let i = 1; i < srcImages.length; i++) {
      const loadId = nextNumericNodeId(workflow);
      workflow[loadId] = {
        class_type: 'LoadImage',
        inputs: { image: srcImages[i] },
        _meta: { title: `SRC_${i + 1}` },
      };
      const imageRef = maybePrepForClipVision([loadId, 0], `Prep SRC_${i + 1} for ClipVision`);

      const ipaId = nextNumericNodeId(workflow);
      const weightI = ipadapterWeightsList[i] ? Number(ipadapterWeightsList[i]) : undefined;
      const weightTypeI = ipadapterWeightTypesList[i] || ipaWeightTypeEnv || workflow[IPADAPTER_ADV_NODE_ID]?.inputs?.weight_type;
      const baseWeight = workflow[IPADAPTER_ADV_NODE_ID]?.inputs?.weight;
      const effectiveWeight =
        typeof weightI === 'number' && !Number.isNaN(weightI)
          ? weightI
          : typeof ipaWeightEnv === 'number' && !Number.isNaN(ipaWeightEnv)
            ? ipaWeightEnv
            : typeof baseWeight === 'number'
              ? baseWeight
              : 1.0;

      const startI = ipadapterStartsList[i] ? Number(ipadapterStartsList[i]) : undefined;
      const endI = ipadapterEndsList[i] ? Number(ipadapterEndsList[i]) : undefined;
      const effectiveStart =
        typeof startI === 'number' && !Number.isNaN(startI)
          ? startI
          : typeof ipaStartEnv === 'number' && !Number.isNaN(ipaStartEnv)
            ? ipaStartEnv
            : workflow[IPADAPTER_ADV_NODE_ID]?.inputs?.start_at;
      const effectiveEnd =
        typeof endI === 'number' && !Number.isNaN(endI)
          ? endI
          : typeof ipaEndEnv === 'number' && !Number.isNaN(ipaEndEnv)
            ? ipaEndEnv
            : workflow[IPADAPTER_ADV_NODE_ID]?.inputs?.end_at;

      workflow[ipaId] = {
        class_type: 'IPAdapterAdvanced',
        inputs: {
          model: [prevIpaNodeId, 0],
          ipadapter: [IPADAPTER_MODEL_LOADER_NODE_ID, 0],
          image: imageRef,
          weight: effectiveWeight,
          weight_type: weightTypeI,
          combine_embeds: ipaCombineEmbedsEnv || workflow[IPADAPTER_ADV_NODE_ID]?.inputs?.combine_embeds,
          start_at: effectiveStart,
          end_at: effectiveEnd,
          embeds_scaling: ipaEmbedsScalingEnv || workflow[IPADAPTER_ADV_NODE_ID]?.inputs?.embeds_scaling,
          clip_vision: [CLIP_VISION_LOADER_NODE_ID, 0],
        },
        _meta: { title: `IPAdapterAdvanced (Track B ${i + 1})` },
      };

      prevIpaNodeId = ipaId;
    }

    if (workflow[KSAMPLER_NODE_ID]?.inputs) {
      workflow[KSAMPLER_NODE_ID].inputs.model = [prevIpaNodeId, 0];
    }
  }

  // Quick-verify defaults: lower resolution + fewer steps unless explicitly disabled.
  const fast = process.env.FAST ? truthy(process.env.FAST) : FAST_DEFAULT;
  const widthEnv = process.env.WIDTH ? Number(process.env.WIDTH) : undefined;
  const heightEnv = process.env.HEIGHT ? Number(process.env.HEIGHT) : undefined;
  const stepsEnv = process.env.STEPS ? Number(process.env.STEPS) : undefined;
  const cfgEnv = process.env.CFG ? Number(process.env.CFG) : undefined;
  const samplerEnv = process.env.SAMPLER_NAME || process.env.SAMPLER;
  const schedulerEnv = process.env.SCHEDULER;
  const denoiseEnv = process.env.DENOISE ? Number(process.env.DENOISE) : undefined;

  if (workflow[EMPTY_LATENT_NODE_ID]?.inputs) {
    const w = !Number.isNaN(widthEnv as any)
      ? (widthEnv as number)
      : fast
        ? FAST_WIDTH
        : workflow[EMPTY_LATENT_NODE_ID].inputs.width;
    const h = !Number.isNaN(heightEnv as any)
      ? (heightEnv as number)
      : fast
        ? FAST_HEIGHT
        : workflow[EMPTY_LATENT_NODE_ID].inputs.height;

    if (typeof w === 'number') workflow[EMPTY_LATENT_NODE_ID].inputs.width = w;
    if (typeof h === 'number') workflow[EMPTY_LATENT_NODE_ID].inputs.height = h;
  }

  if (workflow[KSAMPLER_NODE_ID]?.inputs) {
    const steps = !Number.isNaN(stepsEnv as any)
      ? (stepsEnv as number)
      : fast
        ? FAST_STEPS
        : workflow[KSAMPLER_NODE_ID].inputs.steps;
    const cfg = !Number.isNaN(cfgEnv as any)
      ? (cfgEnv as number)
      : fast
        ? FAST_CFG
        : workflow[KSAMPLER_NODE_ID].inputs.cfg;

    if (typeof steps === 'number') workflow[KSAMPLER_NODE_ID].inputs.steps = steps;
    if (typeof cfg === 'number') workflow[KSAMPLER_NODE_ID].inputs.cfg = cfg;
    if (samplerEnv) workflow[KSAMPLER_NODE_ID].inputs.sampler_name = samplerEnv;
    if (schedulerEnv) workflow[KSAMPLER_NODE_ID].inputs.scheduler = schedulerEnv;
    if (typeof denoiseEnv === 'number' && !Number.isNaN(denoiseEnv)) workflow[KSAMPLER_NODE_ID].inputs.denoise = denoiseEnv;
  }

  return workflow;
}

function makeRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const suffix = randomUUID().slice(0, 8);
  return `${ts}_${suffix}`;
}

function setSaveImagePrefix(workflow: Workflow, nodeId: string, prefix: string): void {
  const n = workflow[nodeId];
  if (!n || n.class_type !== 'SaveImage' || !n.inputs) return;
  n.inputs.filename_prefix = prefix;
}

function nextNumericNodeId(workflow: Workflow): string {
  let max = 0;
  for (const k of Object.keys(workflow)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

function addSaveImageNode(
  workflow: Workflow,
  source: [string, number],
  filenamePrefix: string,
  runDirPrefix?: string,
): string {
  const id = nextNumericNodeId(workflow);
  const fullPrefix = runDirPrefix ? `${runDirPrefix}/${filenamePrefix}` : filenamePrefix;
  workflow[id] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: fullPrefix,
      images: source,
    },
    _meta: { title: `DEBUG SaveImage: ${filenamePrefix}` },
  };
  return id;
}

function applyOutputGrouping(workflow: Workflow, runId: string): Workflow {
  const runDir = `${OUTPUT_DIR_PREFIX}/${runId}`;

  // Final output SaveImage in workflow_api.json is node 7.
  // This creates a subfolder under ComfyUI output so each run is grouped.
  setSaveImagePrefix(workflow, '7', `${runDir}/MEIE_DualTrackInjection`);

  return workflow;
}

function maybeInjectDebugSaves(workflow: Workflow, runId: string): Workflow {
  const debug = process.env.DEBUG ? truthy(process.env.DEBUG) : false;
  if (!debug) return workflow;

  const runDir = `${OUTPUT_DIR_PREFIX}/${runId}`;
  const saveInputs = process.env.DEBUG_SAVE_INPUTS ? truthy(process.env.DEBUG_SAVE_INPUTS) : false;
  const savePrep = process.env.DEBUG_SAVE_PREP ? truthy(process.env.DEBUG_SAVE_PREP) : true;

  // Save intermediate images to ComfyUI output so we can verify conditioning is meaningful.
  // - Canny edge map
  // - (optional) ClipVision preprocessed SRC images (crop/pad to square for IPAdapter)
  // - (optional) original REF/SRC input images (these will look identical to the inputs)
  // Note: These don't affect generation; they just add extra outputs.
  addSaveImageNode(workflow, ['11', 0], 'MEIE_DEBUG_CANNY', runDir);

  const pad2 = (n: number) => String(n).padStart(2, '0');

  if (savePrep) {
    const prepIds = Object.entries(workflow)
      .filter(([, n]) => n.class_type === 'PrepImageForClipVision')
      .map(([id]) => id)
      .sort((a, b) => Number(a) - Number(b));
    prepIds.forEach((id, idx) => {
      addSaveImageNode(workflow, [id, 0], `MEIE_DEBUG_PREP_${pad2(idx + 1)}`, runDir);
    });
  }

  if (saveInputs) {
    addSaveImageNode(workflow, ['10', 0], 'MEIE_DEBUG_INPUT_REF', runDir);

    const srcLoadIds = Object.entries(workflow)
      .filter(
        ([, n]) =>
          n.class_type === 'LoadImage' &&
          (n._meta?.title === 'SRC_FEATURE_STYLE' || (n._meta?.title || '').startsWith('SRC_')),
      )
      .map(([id]) => id)
      .sort((a, b) => Number(a) - Number(b));
    srcLoadIds.forEach((id, idx) => {
      addSaveImageNode(workflow, [id, 0], `MEIE_DEBUG_INPUT_SRC_${pad2(idx + 1)}`, runDir);
    });
  }

  return workflow;
}

async function submitWorkflow(workflowData: Workflow): Promise<SubmitResponse> {
  const response = await fetch(`${COMFYUI_API_BASE}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: workflowData,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as SubmitResponse;
  if (result.node_errors && Object.keys(result.node_errors).length > 0) {
    throw new Error(`Workflow validation failed: ${JSON.stringify(result.node_errors)}`);
  }

  return result;
}

function findImageOutputs(historyData: HistoryData): ImageOutput[] {
  const out: ImageOutput[] = [];
  for (const nodeOutput of Object.values(historyData.outputs || {})) {
    for (const img of nodeOutput.images || []) out.push(img);
  }
  return out;
}

function extractHistoryData(promptId: string, json: any): HistoryData | null {
  if (!json || typeof json !== 'object') return null;
  if (json.outputs && typeof json.outputs === 'object') return json as HistoryData;
  if (json[promptId] && typeof json[promptId] === 'object') return json[promptId] as HistoryData;
  return null;
}

async function pollHistory(promptId: string): Promise<HistoryData> {
  const start = Date.now();
  const maxWaitSecondsEnv = process.env.MAX_WAIT_SECONDS ? Number(process.env.MAX_WAIT_SECONDS) : undefined;
  const maxWaitSeconds = !Number.isNaN(maxWaitSecondsEnv as any) && typeof maxWaitSecondsEnv === 'number'
    ? maxWaitSecondsEnv
    : DEFAULT_MAX_WAIT_SECONDS;
  const deadline = start + maxWaitSeconds * 1000;

  async function tryGetQueueSummary(): Promise<string | null> {
    try {
      const r = await fetch(`${COMFYUI_API_BASE}/queue`);
      if (!r.ok) return null;
      const q = (await r.json()) as any;

      // Common shapes across ComfyUI versions:
      // - { queue_running: [...], queue_pending: [...] }
      // - { Running: [...], Pending: [...] }
      const running = q.queue_running ?? q.Running ?? q.running ?? [];
      const pending = q.queue_pending ?? q.Pending ?? q.pending ?? [];

      const hasPrompt = (entry: any) => {
        // entry can be [number, prompt_id, ...] or an object containing prompt_id
        if (!entry) return false;
        if (Array.isArray(entry)) return entry.includes(promptId);
        if (typeof entry === 'object') return entry.prompt_id === promptId || entry[1] === promptId;
        return false;
      };

      const runningIdx = Array.isArray(running) ? running.findIndex(hasPrompt) : -1;
      const pendingIdx = Array.isArray(pending) ? pending.findIndex(hasPrompt) : -1;

      if (runningIdx >= 0) return `queue: running (index=${runningIdx})`;
      if (pendingIdx >= 0) return `queue: pending (index=${pendingIdx})`;
      if (Array.isArray(running) || Array.isArray(pending)) {
        return `queue: running=${Array.isArray(running) ? running.length : 0} pending=${Array.isArray(pending) ? pending.length : 0}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  console.log(`Max wait: ${maxWaitSeconds}s (override with MAX_WAIT_SECONDS=...)`);

  let attempt = 0;
  while (Date.now() < deadline) {
    const response = await fetch(`${COMFYUI_API_BASE}/history/${promptId}`);
    if (!response.ok) {
      throw new Error(`History request failed (${response.status})`);
    }

    const json = (await response.json()) as any;
    const historyData = extractHistoryData(promptId, json);
    if (historyData) {
      const completed = !!historyData.status?.completed;
      const imgs = findImageOutputs(historyData);
      if (completed || imgs.length > 0) return historyData;
    }

    // Print a heartbeat every ~10 seconds so it doesn't look "stuck".
    if (attempt % 10 === 0) {
      const elapsedSec = Math.round((Date.now() - start) / 1000);
      const queue = await tryGetQueueSummary();
      console.log(`...waiting (${elapsedSec}s)${queue ? ` (${queue})` : ''}`);
    }
    attempt += 1;

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const elapsedSec = Math.round((Date.now() - start) / 1000);
  throw new Error(
    `Execution timeout after ${elapsedSec}s (prompt may still be running; increase MAX_WAIT_SECONDS. prompt_id=${promptId})`,
  );
}

function toViewUrl(image: ImageOutput): string {
  const qs = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || '',
    type: image.type || 'output',
  });
  return `${COMFYUI_API_BASE}/view?${qs.toString()}`;
}

function displayResults(historyData: HistoryData): void {
  const status = historyData.status;
  if (status?.completed) {
    console.log('✓ Status: Completed successfully');
  } else {
    console.log('✗ Status: Failed or incomplete');
    if (status?.messages) console.log('Messages:', status.messages);
  }

  const imgs = findImageOutputs(historyData);
  imgs.forEach((img, idx) => {
    console.log(`Image ${idx + 1}: ${img.filename}`);
    console.log(`  View: ${toViewUrl(img)}`);
  });

  if (imgs.length === 0) console.log('No output images found in history.');
}

async function preflight(workflow: Workflow): Promise<void> {
  console.log('\nPreflight checks:');

  // Local inputs (best-effort).
  const ref = (workflow['10']?.inputs?.image as string) || process.env.REF_IMAGE || 'REF_COMPOSITION.png';
  const srcPrimary = (workflow['20']?.inputs?.image as string) || process.env.SRC_IMAGE || 'SRC_FEATURE_STYLE.png';
  const extraSrc = Object.values(workflow)
    .filter((n) => n.class_type === 'LoadImage' && (n._meta?.title || '').startsWith('SRC_'))
    .map((n) => n.inputs?.image)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  const srcAll = Array.from(new Set([srcPrimary, ...extraSrc]));
  const localPaths = [path.join(COMFY_INPUT_DIR, ref), ...srcAll.map((s) => path.join(COMFY_INPUT_DIR, s))];
  for (const p of localPaths) {
    try {
      await access(p);
      console.log(`  ✓ input exists: ${p}`);
    } catch {
      console.log(`  ! input missing: ${p} (ComfyUI will fail if LoadImage can't find it)`);
    }
  }

  // Verify expected node ids exist (common source of silent “waiting”).
  const required = ['1', '2', '3', '4', '5', '7', '23'];
  const missing = required.filter((id) => !workflow[id]);
  if (missing.length > 0) {
    throw new Error(`workflow_api.json missing required node ids: ${missing.join(', ')}`);
  }

  // Server endpoints.
  try {
    await fetchTextHead(`${COMFYUI_API_BASE}/`);
    console.log('  ✓ / (root) ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ! / (root) failed: ${msg}`);
  }

  try {
    const stats = await fetchJson(`${COMFYUI_API_BASE}/system_stats`);
    const devices = Array.isArray(stats?.devices) ? stats.devices.length : undefined;
    console.log(`  ✓ /system_stats ok${typeof devices === 'number' ? ` (devices=${devices})` : ''}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ! /system_stats failed: ${msg}`);
  }

  try {
    const q = await fetchJson(`${COMFYUI_API_BASE}/queue`);
    const running = q.queue_running ?? q.Running ?? q.running ?? [];
    const pending = q.queue_pending ?? q.Pending ?? q.pending ?? [];
    console.log(
      `  ✓ /queue ok (running=${Array.isArray(running) ? running.length : '?'} pending=${Array.isArray(pending) ? pending.length : '?'})`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ! /queue failed: ${msg}`);
  }

  try {
    await fetchTextHead(`${COMFYUI_API_BASE}/history`);
    console.log('  ✓ /history ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ! /history failed: ${msg}`);
  }
}

function startProgressWs(promptId: string, workflow: Workflow): { close: () => void } {
  const wsUrl = `${toWsBase(COMFYUI_API_BASE)}/ws?clientId=${encodeURIComponent(CLIENT_ID)}`;
  const WS = (globalThis as any).WebSocket as any;
  if (!WS) {
    console.log('  ! WS: WebSocket global not available; skipping /ws progress');
    return { close: () => {} };
  }

  let closed = false;
  let lastExecKey = '';
  let lastProgressAt = 0;

  try {
    const ws = new WS(wsUrl);

    ws.onopen = () => {
      console.log(`  ✓ WS connected: ${wsUrl}`);
    };

    ws.onerror = () => {
      if (!closed) console.log('  ! WS error (progress may be unavailable)');
    };

    ws.onclose = () => {
      if (!closed) console.log('  ! WS closed');
    };

    ws.onmessage = (evt: any) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data));
      } catch {
        return;
      }

      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'executing' && msg.data?.prompt_id === promptId) {
        const nodeId = String(msg.data?.node ?? '');
        const node = workflow[nodeId];
        const title = node?._meta?.title || '';
        const cls = node?.class_type || '';
        const key = `${nodeId}:${title}:${cls}`;
        if (key && key !== lastExecKey) {
          lastExecKey = key;
          console.log(`...executing node ${nodeId}${title ? ` (${title})` : ''}${cls ? ` [${cls}]` : ''}`);
        }
      } else if (msg.type === 'progress' && msg.data?.prompt_id === promptId) {
        const now = Date.now();
        if (now - lastProgressAt > 1000) {
          lastProgressAt = now;
          const v = msg.data?.value;
          const m = msg.data?.max;
          if (typeof v === 'number' && typeof m === 'number') console.log(`...progress ${v}/${m}`);
        }
      } else if (msg.type === 'execution_error' && msg.data?.prompt_id === promptId) {
        console.log('! execution_error:', msg.data);
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
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ! WS connect failed: ${msg}`);
    return { close: () => {} };
  }
}

// --- Main ---

async function main(): Promise<void> {
  console.log('=== MEIE Dual-Track Injection (API) ===');
  console.log(`ComfyUI: ${COMFYUI_API_BASE}`);
  console.log(`Client ID: ${CLIENT_ID}`);
  console.log(`Workflow: ${WORKFLOW_FILE_PATH}`);

  const runId = process.env.RUN_ID || makeRunId();
  console.log(`Run ID: ${runId}`);

  const baseWorkflow = applyOverrides(await loadWorkflow());
  const groupedWorkflow = applyOutputGrouping(baseWorkflow, runId);
  const workflow = maybeInjectDebugSaves(groupedWorkflow, runId);
  await preflight(workflow);

  const fast = process.env.FAST ? truthy(process.env.FAST) : FAST_DEFAULT;
  if (fast) {
    const w = workflow['4']?.inputs?.width;
    const h = workflow['4']?.inputs?.height;
    const steps = workflow['5']?.inputs?.steps;
    console.log(`\nMode: FAST (width=${w} height=${h} steps=${steps}). Set FAST=0 to use workflow defaults.`);
  }

  console.log('\nSubmitting workflow...');
  const submitResult = await submitWorkflow(workflow);
  console.log('✓ Submitted');
  console.log(`  Prompt ID: ${submitResult.prompt_id}`);
  console.log(`  Queue Number: ${submitResult.number}`);

  console.log('\nWaiting for completion...');
  const ws = startProgressWs(submitResult.prompt_id, workflow);
  const historyData = await pollHistory(submitResult.prompt_id);
  ws.close();
  console.log('✓ Finished');

  console.log('\nResults:');
  displayResults(historyData);
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error('\n❌ Error:', error.message);
  } else {
    console.error('\n❌ Unknown error occurred');
  }
  process.exit(1);
});
