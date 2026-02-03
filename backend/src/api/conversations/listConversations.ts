import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('get', '/api/v1/conversations', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const conversations = await prisma.conversation.findMany({
      take: limit,
      skip: offset,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' }, select: { content: true } },
        user: true,
      },
    });

    res.json({
      ok: true,
      conversations,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to list conversations',
      message: error.message,
    });
  }
}, { protected: true });
