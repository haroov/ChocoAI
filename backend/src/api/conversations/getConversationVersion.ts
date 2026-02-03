import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('get', '/api/v1/conversations/:id/version', async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { updatedAt: true },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Use timestamp as version number
    const version = Math.floor(conversation.updatedAt.getTime() / 1000);
    res.json({ version });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
