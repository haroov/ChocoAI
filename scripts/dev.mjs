import { spawn } from 'node:child_process';

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
  delete env.PORT;

  // Some environments set `npm_config_omit=dev` globally; force dev deps on.
  env.npm_config_omit = '';

  const child = spawn(npmCmd(), args, {
    stdio: 'inherit',
    env,
    shell: false,
    // On POSIX, detach so we can signal the whole process group (vite, tsc, etc).
    detached: process.platform !== 'win32',
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

function trySignalChild(name, child, signal) {
  if (!child || !child.pid) return;
  try {
    // If detached on POSIX, the child is the leader of its own process group.
    // Signal the group to ensure sub-processes (vite/tsc) get the signal too.
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      process.kill(child.pid, signal);
    }
    log(`sent ${signal} to ${name} (pid=${child.pid})`);
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
    trySignalChild(name, children.get(name), 'SIGINT');
  }

  // Escalate if anything is still around.
  setTimeout(() => {
    for (const name of CHILD_NAMES) {
      trySignalChild(name, children.get(name), 'SIGTERM');
    }
  }, 2500);

  setTimeout(() => {
    for (const name of CHILD_NAMES) {
      trySignalChild(name, children.get(name), 'SIGKILL');
    }
  }, 8000);

  // Hard stop this supervisor even if children ignore signals.
  setTimeout(() => {
    process.exit(exitCode);
  }, 9000).unref();

  // If all children exit earlier, exit immediately.
  await Promise.allSettled(
    Array.from(children.values()).map((child) => new Promise((res) => child.once('exit', res))),
  );
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  // Second Ctrl+C: force immediate termination.
  if (shuttingDown && Date.now() - shutdownRequestedAt > 200) {
    for (const name of CHILD_NAMES) {
      trySignalChild(name, children.get(name), 'SIGKILL');
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

spawnNpm('backend', ['run', 'dev:backend']);
spawnNpm('frontend', ['run', 'dev:frontend']);

