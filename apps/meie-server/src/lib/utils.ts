import crypto from 'crypto';
import path from 'path';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowMs(): number {
  return Date.now();
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sanitizeHeaderToken(v: string): string {
  // Keep it boring and safe for use in keys/logs/filenames.
  return v.trim().replace(/[^a-zA-Z0-9._:@-]/g, '_').slice(0, 200);
}

export function safeRelPath(...parts: string[]): string {
  // Prevent path traversal. Return POSIX-ish rel path (ComfyUI expects forward slashes in JSON).
  const joined = path.posix.join(...parts.map((p) => p.replace(/\\/g, '/')));
  const norm = path.posix.normalize(joined);
  if (norm.startsWith('../') || norm === '..' || path.posix.isAbsolute(norm)) {
    throw new Error(`Invalid relative path: ${joined}`);
  }
  return norm;
}

export function guessImageExt(filename: string | undefined, contentType: string | undefined): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('image/png')) return '.png';
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg';
  if (ct.includes('image/webp')) return '.webp';

  const ext = filename ? path.extname(filename).toLowerCase() : '';
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return '.png';
}

