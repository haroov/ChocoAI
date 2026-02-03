import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('post', '/api/v1/conversations/new', async (_: Request, res: Response) => {
  try {
    const conversation = await prisma.conversation.create({ data: { channel: 'web' } });

    res.json({ ok: true, conversation });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to create conversation',
      message: error.message,
    });
  }
}, { protected: true });
