import { Secrets } from '../../lib/__secrets';
import { prisma } from '../../core/prisma';
import { registerRoute } from '../../utils/routesRegistry';

registerRoute('get', '/api/v1/health', async (_req, res) => {
  const startTime = Date.now();
  const hasToken = !!(await Secrets.getChocoJwt());
  const mode =
    ((await Secrets.get('CHOCO_AUTH_MODE')) as
      | 'strict'
      | 'optional'
      | 'off') || 'optional';

  // Check database
  let db = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'ready';
    // Note: Keep using runtime config.features instead of database config
    // to ensure feature flags work correctly with environment variables
  } catch {
    db = 'down';
  }

  // Check LLM service
  let llm = 'unconfigured';
  if (await Secrets.getOpenAIKey()) {
    llm = 'connected';
  }

  // Check Choco service
  let choco = 'disabled';
  if (mode !== 'off') {
    choco = hasToken ? 'ready' : 'deferred';
  }

  // Determine overall status
  const criticalServices = [db, llm];
  const hasCriticalFailure =
    criticalServices.includes('down') ||
    criticalServices.includes('unconfigured');
  const hasWarnings = choco === 'deferred' || db === 'down';

  let status = 'green';
  if (hasCriticalFailure) {
    status = 'red';
  } else if (hasWarnings) {
    status = 'amber';
  }

  const latency = Date.now() - startTime;

  res.json({
    ok: !hasCriticalFailure,
    status,
    latency,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0-unified',
    safe: (await Secrets.get('SAFE_MODE')) === 'true',
    db,
    choco,
    services: {
      llm,
    },
    auth: {
      mode,
      hasToken,
      required: mode === 'strict',
    },
    gitSha: (await Secrets.get('GIT_SHA')) || 'unknown',
  });
});
