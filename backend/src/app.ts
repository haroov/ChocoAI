import express from 'express';
import { prisma, config } from './core';
import { initServer } from './server';
import { logger } from './utils/logger';

const bootstrap = async () => {
  let resolve, reject: (...args: unknown[]) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const app = express();

  await initServer(app);
  app.listen(config.port, (error) => {
    if (error) reject(error);
    else {
      logger.info(`🚀 ChocoAI Server running on port ${config.port}`);
    }
  });

  return promise;
};

if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error('Error starting server:', err);
    process.exit(1);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});
