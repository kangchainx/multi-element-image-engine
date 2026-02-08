import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgRoot = path.resolve(__dirname, '..'); // apps/meie-server
const repoRoot = path.resolve(pkgRoot, '..', '..');

const distEntry = path.join(pkgRoot, 'dist', 'api', 'server.js');

const bin = (name) => {
  if (isWin) return path.join(repoRoot, 'node_modules', '.bin', `${name}.cmd`);
  return path.join(repoRoot, 'node_modules', '.bin', name);
};

function spawnBin(name, args, opts) {
  const exe = bin(name);
  // On Windows, .cmd launchers require a shell to run reliably.
  if (isWin) {
    return spawn(exe, args, { ...opts, stdio: 'inherit', shell: true, windowsHide: true });
  }
  return spawn(exe, args, { ...opts, stdio: 'inherit' });
}

function killTree(p) {
  if (!p) return Promise.resolve();
  if (!isWin || !p.pid) {
    try {
      p.kill('SIGINT');
    } catch {
      // ignore
    }
    return Promise.resolve();
  }

  // On Windows, SIGINT doesn't reliably stop a whole process tree (npm/cmd/tsc watchers).
  // Use taskkill /T to avoid orphaned node.exe still listening on ports.
  return new Promise((resolve) => {
    try {
      const k = spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      k.on('exit', () => resolve());
      k.on('error', () => resolve());
    } catch {
      resolve();
    }
  });
}

function waitForFile(p, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(p)) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for: ${p}`));
      setTimeout(tick, 150);
    };
    tick();
  });
}

// 1) Compile in watch mode (writes dist/*).
const tsc = spawnBin('tsc', ['--watch', '--preserveWatchOutput'], {
  cwd: pkgRoot,
});

// 2) Start API (auto-restarts when dist changes).
let nodeProc = null;
let restartTimer = null;
let restarting = false;
let pendingRestart = false;

function startNode() {
  const p = spawn(
    process.execPath,
    ['--env-file-if-exists=../../.env', distEntry],
    { cwd: pkgRoot, stdio: 'inherit', windowsHide: true },
  );
  nodeProc = p;
  p.on('exit', (code) => {
    // Ignore exits from processes that are no longer the active instance (e.g. during restart).
    if (p !== nodeProc) return;
    process.exitCode = code ?? 0;
    void killTree(tsc);
  });
}

async function stopNode() {
  const p = nodeProc;
  nodeProc = null;
  if (!p) return;
  const exited = new Promise((resolve) => p.on('exit', resolve));
  await killTree(p);
  // Avoid overlapping listeners. Wait briefly for the process to actually exit.
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

function restartNode() {
  if (restartTimer) return;
  // On Windows fs.watch can emit a burst of events per compilation; debounce heavily.
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    if (restarting) {
      pendingRestart = true;
      return;
    }
    restarting = true;
    try {
      await stopNode();
      startNode();
    } finally {
      restarting = false;
      if (pendingRestart) {
        pendingRestart = false;
        restartNode();
      }
    }
  }, 800);
}

waitForFile(distEntry, 60_000)
  .then(() => {
    if (nodeProc) return;
    startNode();

    // Restart API when compiled JS changes. (Avoid Node's built-in --watch: it can fail on some Windows setups.)
    try {
      fs.watch(path.join(pkgRoot, 'dist'), { recursive: true }, (_evt, filename) => {
        if (!filename) return;
        const f = String(filename).replace(/\\/g, '/');
        if (!f.endsWith('.js')) return;
        restartNode();
      });
    } catch {
      // ignore; no auto-restart
    }
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    void killTree(tsc);
  });

function shutdown() {
  void stopNode();
  void killTree(tsc);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
