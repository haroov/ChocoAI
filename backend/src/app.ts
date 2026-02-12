import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import { prisma, config } from './core';
import { initServer } from './server';
import { logger } from './utils/logger';

function findPidListeningOnPort(port: number): number | null {
  // Best-effort helper for local development (macOS/Linux).
  // Returns the FIRST PID that listens on the port, or null if unknown.
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const firstLine = String(out || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (!firstLine) return null;
    const pid = Number(firstLine);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

const bootstrap = async () => {
  console.log('DEBUG: Starting bootstrap...');
  let resolve, reject: (...args: unknown[]) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const app = express();

  console.log('DEBUG: Calling initServer...');
  await initServer(app);
  console.log('DEBUG: initServer done, calling listen...');
  const httpServer: Server = app.listen(config.port, (error) => {
    if (error) {
      const anyErr = error as any;
      if (anyErr?.code === 'EADDRINUSE') {
        const pid = findPidListeningOnPort(Number(config.port));
        const pidMsg = pid ? ` (PID ${pid})` : '';
        logger.error(
          `Port ${config.port} is already in use${pidMsg}. It looks like a dev server is already running.`,
        );
        logger.error(
          `Stop the process${pid ? ` (kill ${pid})` : ''} or change the configured port, then restart.`,
        );
      }
      reject(error);
    } else {
      logger.info(`🚀 ChocoAI Server running on port ${config.port}`);
    }
  });

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Shutting down gracefully... (${signal})`);

    // Stop accepting new connections
    await new Promise<void>((res) => {
      if (!httpServer) return res();
      httpServer.close(() => res());
    });

    // Disconnect Prisma, but never hang forever (tsx watch needs this to exit).
    const disconnectTimeoutMs = 5_000;
    await Promise.race([
      prisma.$disconnect().catch(() => undefined),
      new Promise<void>((res) => setTimeout(res, disconnectTimeoutMs)),
    ]);

    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  return promise;
};

bootstrap().catch((err) => {
  logger.error('Error starting server:', err);
  process.exit(1);
});
