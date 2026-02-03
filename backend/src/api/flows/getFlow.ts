import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('get', '/api/v1/flows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) return res.status(404).json({ ok: false, error: 'Flow not found' });
    res.json({ ok: true, flow });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to get flow', message: error?.message });
  }
}, { protected: true });
