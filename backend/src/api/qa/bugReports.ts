import { z } from 'zod';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { logger } from '../../utils/logger';

const bugReportSchema = z.object({
  conversationId: z.string().optional(),
  status: z.enum(['open', 'triaged', 'fixed', 'wontfix']).default('open'),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  type: z.enum(['routing', 'tool', 'copy', 'telemetry', 'extraction', 'other']),
  title: z.string().min(1),
  expected: z.string(),
  actual: z.string(),
  reproSteps: z.string().optional(),
  personaTestId: z.string().optional(),
  environment: z.string().optional(),
  debugBundle: z.any().optional(),
  tags: z.array(z.string()).optional(),
  screenshots: z.array(z.string()).optional(),
});

registerRoute('post', '/api/v1/qa/bug-reports', async (req, res) => {
  try {
    const payload = bugReportSchema.parse(req.body);

    const report = await prisma.qaBugReport.create({
      data: {
        ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
        status: payload.status,
        severity: payload.severity,
        type: payload.type,
        title: payload.title,
        expected: payload.expected,
        actual: payload.actual,
        reproSteps: payload.reproSteps,
        personaTestId: payload.personaTestId,
        environment: payload.environment,
        debugBundle: payload.debugBundle ?? {},
        tags: payload.tags ?? [],
        screenshots: payload.screenshots ?? [],
      },
    });

    res.status(201).json({ ok: true, report });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ ok: false, error: error.errors });
    }
    const code = error?.code || error?.meta?.cause || undefined;
    logger.error('[qa.bugReports] Failed to create bug report', {
      code,
      message: error?.message,
      name: error?.name,
    });
    // Very common prod issue: DB missing migration/table.
    // Prisma error code for missing table can vary by version/provider; keep generic for user.
    res.status(500).json({ ok: false, error: 'Failed to create bug report', errorCode: code || 'BUG_REPORT_CREATE_FAILED' });
  }
}, { protected: true });

registerRoute('get', '/api/v1/qa/bug-reports', async (_, res) => {
  try {
    const reports = await prisma.qaBugReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { conversation: true },
    });
    res.json({ ok: true, reports });
  } catch (error) {
    logger.error('[qa.bugReports] Failed to fetch bug reports', {
      message: (error as any)?.message,
      code: (error as any)?.code,
    });
    res.status(500).json({ ok: false, error: 'Failed to fetch bug reports' });
  }
}, { protected: true });
