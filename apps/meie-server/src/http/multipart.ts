import { IncomingMessage } from 'http';

export type MultipartFilePart = {
  fieldName: string;
  filename: string;
  contentType: string | null;
  data: Buffer;
};

export type MultipartParseResult = {
  fields: Record<string, string[]>;
  files: MultipartFilePart[];
};

function parseContentTypeHeader(v: string): { mime: string; boundary: string | null } {
  const parts = v.split(';').map((s) => s.trim());
  const mime = parts[0]?.toLowerCase() || '';
  let boundary: string | null = null;
  for (const p of parts.slice(1)) {
    const m = p.match(/^boundary=(.*)$/i);
    if (m) {
      boundary = m[1].trim();
      if (boundary.startsWith('"') && boundary.endsWith('"')) boundary = boundary.slice(1, -1);
    }
  }
  return { mime, boundary };
}

function parsePartHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headerText.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (k) headers[k] = v;
  }
  return headers;
}

function parseContentDisposition(v: string): { name: string | null; filename: string | null } {
  // Example: form-data; name="ref"; filename="a.png"
  const parts = v.split(';').map((s) => s.trim());
  if (parts[0]?.toLowerCase() !== 'form-data') return { name: null, filename: null };
  let name: string | null = null;
  let filename: string | null = null;
  for (const p of parts.slice(1)) {
    const m1 = p.match(/^name=(.*)$/i);
    if (m1) {
      name = m1[1].trim();
      if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
      continue;
    }
    const m2 = p.match(/^filename=(.*)$/i);
    if (m2) {
      filename = m2[1].trim();
      if (filename.startsWith('"') && filename.endsWith('"')) filename = filename.slice(1, -1);
      continue;
    }
  }
  return { name, filename };
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > maxBytes) {
      throw new Error(`request body too large (${total} bytes > ${maxBytes})`);
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

export async function parseMultipartForm(
  req: IncomingMessage,
  opts: { maxBytes: number; maxFiles: number },
): Promise<MultipartParseResult> {
  const ct = String(req.headers['content-type'] || '');
  const { mime, boundary } = parseContentTypeHeader(ct);
  if (mime !== 'multipart/form-data' || !boundary) {
    throw new Error('expected multipart/form-data');
  }

  const body = await readBody(req, opts.maxBytes);
  const boundaryBuf = Buffer.from(`--${boundary}`);

  const fields: Record<string, string[]> = {};
  const files: MultipartFilePart[] = [];

  let pos = 0;
  while (true) {
    const start = body.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    pos = start + boundaryBuf.length;

    // End boundary: "--"
    if (body[pos] === 45 && body[pos + 1] === 45) break;

    // Skip CRLF after boundary
    if (body[pos] === 13 && body[pos + 1] === 10) pos += 2;

    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerText = body.slice(pos, headerEnd).toString('utf-8');
    const headers = parsePartHeaders(headerText);
    const cd = headers['content-disposition'] || '';
    const { name, filename } = parseContentDisposition(cd);
    const contentType = headers['content-type'] || null;

    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(boundaryBuf, dataStart);
    if (nextBoundary === -1) break;
    let dataEnd = nextBoundary;
    // Strip trailing CRLF before boundary.
    if (body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2;

    const data = body.slice(dataStart, dataEnd);

    if (name) {
      if (filename) {
        if (files.length + 1 > opts.maxFiles) throw new Error(`too many files (>${opts.maxFiles})`);
        files.push({ fieldName: name, filename, contentType, data });
      } else {
        const val = data.toString('utf-8');
        if (!fields[name]) fields[name] = [];
        fields[name].push(val);
      }
    }

    pos = nextBoundary;
  }

  return { fields, files };
}

