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

    const conversationsWithData = await Promise.all(conversations.map(async (conv) => {
      let userData: Record<string, unknown> = {};
      if (conv.userId) {
        // We don't have a specific flowId context here, so we get all user data
        // Ideally we might want to prioritize the latest flow, but getUserData handles merging
        // Note: this might be N+1, but for page size 50 it should be acceptable for now
        // A better approach later would be to fetch all userData for all userIds in one query
        const { flowHelpers } = await import('../../lib/flowEngine/flowHelpers');
        userData = await flowHelpers.getUserData(conv.userId);
      }
      return { ...conv, userData };
    }));

    res.json({
      ok: true,
      conversations: conversationsWithData,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to list conversations',
      message: error.message,
    });
  }
}, { protected: true });
