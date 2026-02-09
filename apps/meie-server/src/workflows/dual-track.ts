import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export type WorkflowNode = {
  inputs: Record<string, any>;
  class_type: string;
  _meta?: { title?: string };
  pos?: [number, number];
};

export type Workflow = Record<string, WorkflowNode>;

export type WorkflowMode = 'legacy' | 'lite' | 'full';

export type DualTrackParams = {
  workflow_mode?: 'lite' | 'full'; // default handled by worker (lite)
  workflow_strict?: boolean; // if true, do not auto-fallback to simpler workflows

  // Prompt automation (primarily used by workflow_api.full.json).
  prompt_mode?: 'auto' | 'manual' | 'hybrid'; // default handled by worker (auto for full, manual for lite)
  auto_prompt_template?: string;

  // Mask automation (primarily used by workflow_api.full.json).
  mask_mode?: 'none' | 'auto_subject'; // default handled by worker

  positive_prompt?: string;
  negative_prompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  denoise?: number;

  // ControlNet (legacy single-apply fields).
  controlnet_strength?: number;
  controlnet_start?: number;
  controlnet_end?: number;

  // ControlNet (dual-apply fields for lite/full workflows).
  controlnet_canny_strength?: number;
  controlnet_canny_start?: number;
  controlnet_canny_end?: number;
  controlnet_depth_strength?: number;
  controlnet_depth_start?: number;
  controlnet_depth_end?: number;

  canny_low?: number; // NOTE: ComfyUI Canny node expects 0.01~0.99 floats in this workflow.
  canny_high?: number;

  ipadapter_weights?: number[];
  ipadapter_weight_types?: string[];
  ipadapter_starts?: number[];
  ipadapter_ends?: number[];
  ipadapter_embeds_scaling?: string;
  ipadapter_combine_embeds?: string;

  // "pad" recommended for non-square refs; if unset we keep workflow default (center-crop).
  ipadapter_crop_position?: string;
  ipadapter_interpolation?: string;
  ipadapter_sharpening?: number;
};

type DualTrackNodeIds = {
  posPrompt: string;
  negPrompt: string;
  emptyLatent: string;
  ksampler: string;
  saveImage: string;
  refLoad: string;
  canny: string;
  controlNetApply: string;
  srcLoad: string;
  clipVision: string;
  ipadapterModel: string;
  ipadapterAdv: string;
};

// Default IDs match the repo's workflow_api.json, but IDs are not stable if the workflow is edited and re-exported.
// Prefer resolving by _meta.title (stable node titles), and fall back to these numeric defaults for compatibility.
const DEFAULT_DUAL_TRACK_NODE_IDS: DualTrackNodeIds = {
  posPrompt: '2',
  negPrompt: '3',
  emptyLatent: '4',
  ksampler: '5',
  saveImage: '7',
  refLoad: '10',
  canny: '11',
  controlNetApply: '13',
  srcLoad: '20',
  clipVision: '21',
  ipadapterModel: '22',
  ipadapterAdv: '23',
};

const DUAL_TRACK_TITLE_HINTS: Record<keyof DualTrackNodeIds, { title: string; classType?: string }> = {
  posPrompt: { title: 'POS_PROMPT', classType: 'CLIPTextEncode' },
  negPrompt: { title: 'NEG_PROMPT', classType: 'CLIPTextEncode' },
  emptyLatent: { title: 'Empty Latent', classType: 'EmptyLatentImage' },
  ksampler: { title: 'KSampler', classType: 'KSampler' },
  saveImage: { title: 'SaveImage', classType: 'SaveImage' },
  refLoad: { title: 'REF_COMPOSITION', classType: 'LoadImage' },
  canny: { title: 'Canny Preprocessor', classType: 'Canny' },
  controlNetApply: { title: 'ControlNetApply (Track A)', classType: 'ControlNetApplyAdvanced' },
  srcLoad: { title: 'SRC_FEATURE_STYLE', classType: 'LoadImage' },
  clipVision: { title: 'CLIPVisionLoader', classType: 'CLIPVisionLoader' },
  ipadapterModel: { title: 'IPAdapterModelLoader', classType: 'IPAdapterModelLoader' },
  ipadapterAdv: { title: 'IPAdapterAdvanced (Track B)', classType: 'IPAdapterAdvanced' },
};

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
  // If the workflow contains duplicates (e.g. multiple SaveImage nodes with the same title),
  // prefer the smallest numeric id to keep behavior deterministic.
  if (hits.length > 1) {
    const sorted = hits
      .map((x) => ({ id: x, n: Number(x) }))
      .sort((a, b) => (Number.isFinite(a.n) ? a.n : Number.MAX_SAFE_INTEGER) - (Number.isFinite(b.n) ? b.n : Number.MAX_SAFE_INTEGER));
    return sorted[0]?.id ?? null;
  }
  return null;
}

function findFirstNodeIdByClassType(workflow: Workflow, classType: string): string | null {
  const hits: string[] = [];
  for (const [id, node] of Object.entries(workflow || {})) {
    if (!node || typeof node !== 'object') continue;
    if (node.class_type !== classType) continue;
    hits.push(id);
  }
  if (hits.length === 0) return null;
  const sorted = hits
    .map((x) => ({ id: x, n: Number(x) }))
    .sort((a, b) => (Number.isFinite(a.n) ? a.n : Number.MAX_SAFE_INTEGER) - (Number.isFinite(b.n) ? b.n : Number.MAX_SAFE_INTEGER));
  return sorted[0]?.id ?? null;
}

function resolveDualTrackNodeIds(base: Workflow): DualTrackNodeIds {
  const ids = { ...DEFAULT_DUAL_TRACK_NODE_IDS };
  for (const k of Object.keys(ids) as Array<keyof DualTrackNodeIds>) {
    const hint = DUAL_TRACK_TITLE_HINTS[k];
    const found = hint ? findNodeIdByTitle(base, hint.title, hint.classType) : null;
    if (found) ids[k] = found;
  }
  // If the workflow was re-exported and the empty latent title changed, fall back to class_type resolution.
  if (!findNodeIdByTitle(base, DUAL_TRACK_TITLE_HINTS.emptyLatent.title, DUAL_TRACK_TITLE_HINTS.emptyLatent.classType)) {
    const byType = findFirstNodeIdByClassType(base, 'EmptyLatentImage');
    if (byType) ids.emptyLatent = byType;
  }
  return ids;
}

function nextNumericNodeId(workflow: Workflow): string {
  let max = 0;
  for (const k of Object.keys(workflow)) {
    const n = Number(k);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return String(max + 1);
}

function maybeNumber(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (!Number.isFinite(v)) return undefined;
  return v;
}

function maybeString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

function repoRootFromHere(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const pkgRoot = path.resolve(__dirname, '..', '..'); // apps/meie-server
  return path.resolve(pkgRoot, '..', '..');
}

export function workflowFilenameForMode(mode: WorkflowMode): string {
  if (mode === 'lite') return 'workflow_api.lite.json';
  if (mode === 'full') return 'workflow_api.full.json';
  return 'workflow_api.json';
}

export async function loadWorkflowFileFromRepoRoot(filename: string): Promise<Workflow> {
  const p = path.resolve(repoRootFromHere(), filename);
  const text = await readFile(p, 'utf-8');
  return JSON.parse(text) as Workflow;
}

export async function loadBaseWorkflow(): Promise<Workflow> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const pkgRoot = path.resolve(__dirname, '..', '..');
  const p = path.resolve(pkgRoot, '../../workflow_api.json');
  const text = await readFile(p, 'utf-8');
  return JSON.parse(text) as Workflow;
}

function applyControlNetWindow(
  workflow: Workflow,
  nodeId: string,
  opts: { strength?: number; start?: number; end?: number },
): void {
  const n = workflow?.[nodeId];
  if (!n?.inputs) return;
  const strength = maybeNumber(opts.strength);
  const start = maybeNumber(opts.start);
  const end = maybeNumber(opts.end);
  if (strength !== undefined) n.inputs.strength = strength;
  if (start !== undefined) n.inputs.start_percent = start;
  if (end !== undefined) n.inputs.end_percent = end;
}

export function buildDualTrackWorkflow(opts: {
  base: Workflow;
  jobId: string;
  outputDirPrefix: string;
  refRel: string;
  srcRels: string[];
  params: DualTrackParams;
  debug: boolean;
}): Workflow {
  // Deep clone to avoid mutation leaking across jobs.
  const workflow: Workflow = JSON.parse(JSON.stringify(opts.base)) as Workflow;

  const ids = resolveDualTrackNodeIds(workflow);

  // Input filenames (ComfyUI reads from its input directory).
  if (workflow[ids.refLoad]?.inputs) workflow[ids.refLoad].inputs.image = opts.refRel;
  if (workflow[ids.srcLoad]?.inputs) workflow[ids.srcLoad].inputs.image = opts.srcRels[0] || opts.refRel;

  // Output grouping.
  if (workflow[ids.saveImage]?.inputs) {
    workflow[ids.saveImage].inputs.filename_prefix = `${opts.outputDirPrefix}/${opts.jobId}/final`;
  }

  // Text prompts.
  const pos = maybeString(opts.params.positive_prompt);
  if (pos && workflow[ids.posPrompt]?.inputs) workflow[ids.posPrompt].inputs.text = pos;
  const neg = maybeString(opts.params.negative_prompt);
  if (neg && workflow[ids.negPrompt]?.inputs) workflow[ids.negPrompt].inputs.text = neg;

  // Latent size.
  if (workflow[ids.emptyLatent]?.inputs) {
    const w = maybeNumber(opts.params.width);
    const h = maybeNumber(opts.params.height);
    const align64 = (n: number) => Math.max(256, Math.trunc(Math.floor(n / 64) * 64));
    if (w) workflow[ids.emptyLatent].inputs.width = align64(w);
    if (h) workflow[ids.emptyLatent].inputs.height = align64(h);
  }

  // Sampler parameters.
  if (workflow[ids.ksampler]?.inputs) {
    const seed = maybeNumber(opts.params.seed);
    const steps = maybeNumber(opts.params.steps);
    const cfg = maybeNumber(opts.params.cfg);
    const sampler = maybeString(opts.params.sampler_name);
    const scheduler = maybeString(opts.params.scheduler);
    const denoise = maybeNumber(opts.params.denoise);
    // Default to a random seed if unset; makes jobs independent by default.
    if (seed !== undefined) workflow[ids.ksampler].inputs.seed = Math.trunc(seed);
    else workflow[ids.ksampler].inputs.seed = Math.floor(Math.random() * 2 ** 31);
    if (steps !== undefined) workflow[ids.ksampler].inputs.steps = Math.trunc(steps);
    if (cfg !== undefined) workflow[ids.ksampler].inputs.cfg = cfg;
    if (sampler) workflow[ids.ksampler].inputs.sampler_name = sampler;
    if (scheduler) workflow[ids.ksampler].inputs.scheduler = scheduler;
    if (denoise !== undefined) workflow[ids.ksampler].inputs.denoise = denoise;
  }

  // Canny thresholds (normalized floats in this workflow).
  if (workflow[ids.canny]?.inputs) {
    const low = maybeNumber(opts.params.canny_low);
    const high = maybeNumber(opts.params.canny_high);
    if (low !== undefined) workflow[ids.canny].inputs.low_threshold = low;
    if (high !== undefined) workflow[ids.canny].inputs.high_threshold = high;
  }

  // ControlNet window (supports both legacy single-apply and new dual-apply workflows).
  const cnCannyId =
    findNodeIdByTitle(workflow, 'CONTROLNET_APPLY_CANNY', 'ControlNetApplyAdvanced') ||
    findNodeIdByTitle(workflow, 'ControlNetApply (Canny)', 'ControlNetApplyAdvanced') ||
    null;
  const cnDepthId =
    findNodeIdByTitle(workflow, 'CONTROLNET_APPLY_DEPTH', 'ControlNetApplyAdvanced') ||
    findNodeIdByTitle(workflow, 'ControlNetApply (Depth)', 'ControlNetApplyAdvanced') ||
    null;

  if (cnCannyId || cnDepthId) {
    // Dual-apply: set canny and depth independently. Fall back to legacy controlnet_* fields for canny if needed.
    const cannyStrength = opts.params.controlnet_canny_strength ?? opts.params.controlnet_strength;
    const cannyStart = opts.params.controlnet_canny_start ?? opts.params.controlnet_start;
    const cannyEnd = opts.params.controlnet_canny_end ?? opts.params.controlnet_end;
    if (cnCannyId) applyControlNetWindow(workflow, cnCannyId, { strength: cannyStrength, start: cannyStart, end: cannyEnd });

    if (cnDepthId) {
      applyControlNetWindow(workflow, cnDepthId, {
        strength: opts.params.controlnet_depth_strength ?? 1.0,
        start: opts.params.controlnet_depth_start ?? 0.0,
        end: opts.params.controlnet_depth_end ?? 1.0,
      });
    }
  } else if (workflow[ids.controlNetApply]?.inputs) {
    // Legacy single-apply: preserve existing behavior.
    applyControlNetWindow(workflow, ids.controlNetApply, {
      strength: opts.params.controlnet_strength,
      start: opts.params.controlnet_start,
      end: opts.params.controlnet_end,
    });
  }

  // Optional: IPAdapter pre-processing to avoid center-crop (better for non-square refs).
  const cropPos = maybeString(opts.params.ipadapter_crop_position);
  const interpolation = maybeString(opts.params.ipadapter_interpolation) || 'LANCZOS';
  const sharpening = maybeNumber(opts.params.ipadapter_sharpening) ?? 0.0;

  const ensurePrep = (imageRef: [string, number], title: string): [string, number] => {
    if (!cropPos) return imageRef;
    const prepId = nextNumericNodeId(workflow);
    workflow[prepId] = {
      class_type: 'PrepImageForClipVision',
      inputs: {
        image: imageRef,
        interpolation,
        crop_position: cropPos,
        sharpening,
      },
      _meta: { title },
    };
    return [prepId, 0];
  };

  // IPAdapter base node overrides (src0).
  if (workflow[ids.ipadapterAdv]?.inputs) {
    if (cropPos) {
      workflow[ids.ipadapterAdv].inputs.image = ensurePrep([ids.srcLoad, 0], 'Prep SRC_0 for ClipVision');
    }

    // Masking: if user explicitly disables, remove any attn_mask wiring from the base workflow.
    // (Some IPAdapter variants call this input "attn_mask".)
    if (opts.params.mask_mode === 'none') {
      try {
        delete (workflow[ids.ipadapterAdv].inputs as any).attn_mask;
      } catch {
        // ignore
      }
    }

    const w0 = Array.isArray(opts.params.ipadapter_weights) ? opts.params.ipadapter_weights[0] : undefined;
    const wt0 = Array.isArray(opts.params.ipadapter_weight_types) ? opts.params.ipadapter_weight_types[0] : undefined;
    const s0 = Array.isArray(opts.params.ipadapter_starts) ? opts.params.ipadapter_starts[0] : undefined;
    const e0 = Array.isArray(opts.params.ipadapter_ends) ? opts.params.ipadapter_ends[0] : undefined;

    if (typeof w0 === 'number' && Number.isFinite(w0)) workflow[ids.ipadapterAdv].inputs.weight = w0;
    if (typeof wt0 === 'string' && wt0.trim()) workflow[ids.ipadapterAdv].inputs.weight_type = wt0.trim();
    if (typeof s0 === 'number' && Number.isFinite(s0)) workflow[ids.ipadapterAdv].inputs.start_at = s0;
    if (typeof e0 === 'number' && Number.isFinite(e0)) workflow[ids.ipadapterAdv].inputs.end_at = e0;

    const embedsScaling = maybeString(opts.params.ipadapter_embeds_scaling);
    const combineEmbeds = maybeString(opts.params.ipadapter_combine_embeds);
    if (embedsScaling) workflow[ids.ipadapterAdv].inputs.embeds_scaling = embedsScaling;
    if (combineEmbeds) workflow[ids.ipadapterAdv].inputs.combine_embeds = combineEmbeds;
  }

  // Multi-source: chain IPAdapterAdvanced nodes (one per source image).
  let lastIpaNodeId: string = ids.ipadapterAdv;
  const srcs = opts.srcRels;
  if (srcs.length > 1) {
    for (let i = 1; i < srcs.length; i++) {
      const loadId = nextNumericNodeId(workflow);
      workflow[loadId] = {
        class_type: 'LoadImage',
        inputs: { image: srcs[i] },
        _meta: { title: `SRC_${i}` },
      };

      const w = Array.isArray(opts.params.ipadapter_weights) ? opts.params.ipadapter_weights[i] : undefined;
      const wt = Array.isArray(opts.params.ipadapter_weight_types) ? opts.params.ipadapter_weight_types[i] : undefined;
      const s = Array.isArray(opts.params.ipadapter_starts) ? opts.params.ipadapter_starts[i] : undefined;
      const e = Array.isArray(opts.params.ipadapter_ends) ? opts.params.ipadapter_ends[i] : undefined;

      // IMPORTANT: ensurePrep() may allocate a new node id via nextNumericNodeId().
      // So we must call it BEFORE allocating ipaId, otherwise the prep node may take the same id
      // and get overwritten, causing self-referential links like image=[ipaId,0].
      const imageRef = cropPos ? ensurePrep([loadId, 0], `Prep SRC_${i} for ClipVision`) : ([loadId, 0] as [string, number]);
      const ipaId = nextNumericNodeId(workflow);

      workflow[ipaId] = {
        class_type: 'IPAdapterAdvanced',
        inputs: {
          model: [lastIpaNodeId, 0],
          ipadapter: [ids.ipadapterModel, 0],
          image: imageRef,
          weight: typeof w === 'number' && Number.isFinite(w) ? w : workflow[ids.ipadapterAdv]?.inputs?.weight ?? 0.8,
          weight_type: typeof wt === 'string' && wt.trim() ? wt.trim() : workflow[ids.ipadapterAdv]?.inputs?.weight_type ?? 'style transfer',
          combine_embeds: workflow[ids.ipadapterAdv]?.inputs?.combine_embeds ?? 'concat',
          start_at: typeof s === 'number' && Number.isFinite(s) ? s : workflow[ids.ipadapterAdv]?.inputs?.start_at ?? 0,
          end_at: typeof e === 'number' && Number.isFinite(e) ? e : workflow[ids.ipadapterAdv]?.inputs?.end_at ?? 1,
          embeds_scaling: workflow[ids.ipadapterAdv]?.inputs?.embeds_scaling ?? 'V only',
          clip_vision: [ids.clipVision, 0],
        },
        _meta: { title: `IPAdapterAdvanced SRC_${i}` },
      };

      lastIpaNodeId = ipaId;
    }
  }

  // Ensure sampler uses the final model output.
  if (workflow[ids.ksampler]?.inputs) {
    workflow[ids.ksampler].inputs.model = [lastIpaNodeId, 0];
  }

  // Debug: save Canny output (helps validate composition track).
  if (opts.debug) {
    const debugSaveId = nextNumericNodeId(workflow);
    workflow[debugSaveId] = {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: `${opts.outputDirPrefix}/${opts.jobId}/debug/canny`,
        images: [ids.canny, 0],
      },
      _meta: { title: 'DEBUG Save Canny' },
    };
  }

  return workflow;
}
