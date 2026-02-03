import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('delete', '/api/v1/flows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const flow = await prisma.flow.findUnique({ where: { id }, select: { id: true, slug: true, definition: true } });
    if (!flow) return res.status(404).json({ ok: false, error: 'Flow not found' });

    // Protect flows marked as defaultForNewUsers
    const definition = flow.definition as any;
    if (definition?.config?.defaultForNewUsers === true) {
      return res.status(400).json({ ok: false, error: 'Default entry flow cannot be deleted' });
    }

    const [messageCount, userDataCount, userFlowCount] = await Promise.all([
      prisma.message.count({ where: { flowId: id } }),
      prisma.userData.count({ where: { flowId: id } }),
      prisma.userFlow.count({ where: { flowId: id } }),
    ]);
    if (messageCount + userDataCount + userFlowCount > 0) {
      return res.status(409).json({ ok: false, error: 'Flow is in use and cannot be deleted' });
    }

    await prisma.flow.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to delete flow', message: error?.message });
  }
}, { protected: true });
