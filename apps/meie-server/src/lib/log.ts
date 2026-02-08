type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function ts(): string {
  return new Date().toISOString();
}

function shouldDebug(): boolean {
  const v = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
  return v === 'debug';
}

function fmtExtra(extra: any): string {
  if (extra === undefined || extra === null) return '';
  try {
    if (typeof extra === 'string') return ` ${extra}`;
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ' [unserializable]';
  }
}

export function log(level: LogLevel, msg: string, extra?: any): void {
  if (level === 'debug' && !shouldDebug()) return;
  const line = `${ts()} [${level}] ${msg}${fmtExtra(extra)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function jobLog(jobId: string, level: LogLevel, msg: string, extra?: any): void {
  log(level, `[job ${jobId}] ${msg}`, extra);
}

