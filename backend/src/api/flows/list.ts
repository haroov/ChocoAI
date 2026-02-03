import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('get', '/api/v1/flows', async (_req, res) => {
  try {
    const flows = await prisma.flow.findMany({
      select: { id: true, name: true, slug: true, version: true, description: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, flows });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to list flows' });
  }
}, { protected: true });
