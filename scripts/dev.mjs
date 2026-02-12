import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

const CHILD_NAMES = ['backend', 'frontend'];
const children = new Map();
let shuttingDown = false;
let shutdownRequestedAt = 0;

function log(msg) {
  // Keep logs stable and easy to grep.
  console.log(`[dev] ${msg}`);
}

function spawnNpm(name, args) {
  const env = { ...process.env };

  // Ensure local dev expectations even if the parent environment injects these.
  env.NODE_ENV = 'development';
  // Don't let parent shells/IDEs inject PORT accidentally (breaks local routing),
  // but allow explicit override via DEV_BACKEND_PORT.
  delete env.PORT;
  if (name === 'backend' && process.env.DEV_BACKEND_PORT) {
    env.PORT = String(process.env.DEV_BACKEND_PORT);
  }

  // Some environments set `npm_config_omit=dev` globally; force dev deps on.
  env.npm_config_omit = '';

  const child = spawn(npmCmd(), args, {
    stdio: 'inherit',
    env,
    shell: false,
    // IMPORTANT: keep children in the same process group as this supervisor.
    // This ensures Ctrl+C in the terminal reaches backend/frontend and avoids
    // orphaned processes that keep running after the supervisor exits.
    detached: false,
  });

  child.on('exit', (code, signal) => {
    // If either child exits, stop the whole dev session (like concurrently).
    // Avoid re-entrancy if we're already shutting down.
    if (shuttingDown) return;
    const exitCode = signal ? 1 : (typeof code === 'number' ? code : 1);
    void shutdown(`${name} exited`, exitCode);
  });

  children.set(name, child);
  log(`started ${name} (pid=${child.pid})`);
  return child;
}

function getPidListeningOnPort(port) {
  try {
    const out = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const pid = Number(String(out || '').trim().split('\n').filter(Boolean)[0]);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function getCommandForPid(pid) {
  try {
    return String(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })).trim();
  } catch {
    return '';
  }
}

function getDescendantPids(rootPid) {
  // Returns descendants only (not including rootPid).
  // Best-effort; if ps fails, returns empty list.
  try {
    const out = String(execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }));
    const parentToChildren = new Map();
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) continue;
      const pid = Number(parts[0]);
      const ppid = Number(parts[1]);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
      const arr = parentToChildren.get(ppid) || [];
      arr.push(pid);
      parentToChildren.set(ppid, arr);
    }
    const descendants = [];
    const stack = [rootPid];
    while (stack.length) {
      const cur = stack.pop();
      const kids = parentToChildren.get(cur) || [];
      for (const k of kids) {
        descendants.push(k);
        stack.push(k);
      }
    }
    return descendants;
  } catch {
    return [];
  }
}

function trySignalProcessTree(name, child, signal) {
  if (!child || !child.pid) return;
  try {
    const rootPid = child.pid;
    const descendants = getDescendantPids(rootPid);
    // Kill leaves first, then root.
    const pids = [...descendants.reverse(), rootPid];
    for (const pid of pids) {
      try { process.kill(pid, signal); } catch { /* ignore */ }
    }
    log(`sent ${signal} to ${name} (pid=${rootPid}, descendants=${descendants.length})`);
  } catch {
    // Process already gone or permission error; ignore.
  }
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownRequestedAt = Date.now();
  log(`shutting down (${reason})...`);

  for (const name of CHILD_NAMES) {
    trySignalProcessTree(name, children.get(name), 'SIGINT');
  }

  // Escalate if anything is still around.
  setTimeout(() => {
    for (const name of CHILD_NAMES) {
      trySignalProcessTree(name, children.get(name), 'SIGTERM');
    }
  }, 2500);

  setTimeout(() => {
    for (const name of CHILD_NAMES) {
      trySignalProcessTree(name, children.get(name), 'SIGKILL');
    }
  }, 8000);

  // Hard stop this supervisor even if children ignore signals.
  setTimeout(() => {
    process.exit(exitCode);
  }, 9000).unref();

  // If all children exit earlier, exit immediately.
  await Promise.allSettled(
    Array.from(children.values()).map((child) => new Promise((res) => {
      if (child.exitCode !== null) return res();
      child.once('exit', res);
    })),
  );
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  // Second Ctrl+C: force immediate termination.
  if (shuttingDown && Date.now() - shutdownRequestedAt > 200) {
    for (const name of CHILD_NAMES) {
      trySignalProcessTree(name, children.get(name), 'SIGKILL');
    }
    process.exit(1);
  }
  void shutdown('SIGINT', 0);
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});

process.on('uncaughtException', (err) => {
  console.error('[dev] uncaughtException', err);
  void shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (err) => {
  console.error('[dev] unhandledRejection', err);
  void shutdown('unhandledRejection', 1);
});

async function ensureBackendPortAvailable() {
  const desiredPort = process.env.DEV_BACKEND_PORT ? Number(process.env.DEV_BACKEND_PORT) : 8080;
  const pid = getPidListeningOnPort(desiredPort);
  if (!pid) return;

  const cmd = getCommandForPid(pid);
  const looksLikeChocoBackend =
    cmd.includes('/chocoAI/backend') ||
    cmd.includes('backend/src/app.ts') ||
    cmd.includes('tsx src/app.ts') ||
    cmd.includes('dist/api/unified-server');

  if (!process.env.DEV_BACKEND_PORT && looksLikeChocoBackend) {
    log(`port ${desiredPort} is in use by previous backend (pid=${pid}); stopping it...`);
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    await delay(1500);
    const still = getPidListeningOnPort(desiredPort);
    if (still) {
      try { process.kill(still, 'SIGKILL'); } catch { /* ignore */ }
      await delay(200);
    }
    return;
  }

  log(`port ${desiredPort} is already in use (pid=${pid}).`);
  log(`Stop it (kill ${pid}) or run with DEV_BACKEND_PORT=8081 npm run dev`);
}

await ensureBackendPortAvailable();
spawnNpm('backend', ['run', 'dev:backend']);
spawnNpm('frontend', ['run', 'dev:frontend']);

