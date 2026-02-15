import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('get', '/api/v1/conversations/:id/api-calls', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();

    if (!id) {
      res.status(400).json({
        ok: false,
        error: 'Missing conversation ID',
      });
      return;
    }

    const apiCalls = await prisma.apiCall.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      ok: true,
      apiCalls,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Failed to get API calls',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}, { protected: true });
