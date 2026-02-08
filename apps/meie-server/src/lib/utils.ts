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

export function sniffImageExt(buf: Buffer): '.png' | '.jpg' | '.webp' | null {
  if (!buf || buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return '.png';
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return '.jpg';
  }

  // WebP: "RIFF"...."WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return '.webp';
  }

  return null;
}

