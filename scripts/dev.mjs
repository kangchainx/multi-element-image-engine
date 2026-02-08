import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npmExe = isWin ? 'npm.cmd' : 'npm';

function killTree(p) {
  if (!p) return;
  if (!isWin || !p.pid) {
    try {
      p.kill('SIGINT');
    } catch {
      // ignore
    }
    return;
  }
  try {
    spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {
    // ignore
  }
}

function spawnNpm(label, args) {
  const p = spawn(npmExe, args, {
    stdio: 'inherit',
    windowsHide: true,
  });
  p.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const c = code ?? 0;
    console.error(`[dev] ${label} exited (code=${c} signal=${signal || ''})`);
    shutdown(c || 1);
  });
  return p;
}

let shuttingDown = false;
const procs = [
  spawnNpm('server', ['run', 'dev:server']),
  spawnNpm('worker', ['run', 'dev:worker']),
  spawnNpm('ui', ['run', 'dev:ui']),
];

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    killTree(p);
  }
  // Give children a moment to exit, then hard-exit.
  setTimeout(() => process.exit(exitCode), 2000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
