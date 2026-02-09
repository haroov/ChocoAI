import { spawn } from 'node:child_process';

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
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
  });

  child.on('exit', (code, signal) => {
    // If either child exits, stop the whole dev session.
    // This keeps behavior similar to the old concurrently setup.
    if (signal) process.exit(1);
    process.exit(typeof code === 'number' ? code : 1);
  });

  console.log(`[dev] started ${name} (pid=${child.pid})`);
  return child;
}

spawnNpm('backend', ['run', 'dev:backend']);
spawnNpm('frontend', ['run', 'dev:frontend']);

