import { registerRoute } from '../../utils/routesRegistry';
import { flowTracer } from '../../lib/observability/flowTracer';
import { prisma } from '../../core/prisma';

/**
 * GET /api/admin/flows/:conversationId/trace
 * Returns flow timeline for a conversation with current stage information
 */
registerRoute('get', '/api/v1/admin/flows/:conversationId/trace', async (req, res) => {
  try {
    const { conversationId } = req.params;

    const traces = await flowTracer.getConversationTrace(conversationId);

    // Get current stage from userFlow to determine which traces are actually "in progress"
    let currentFlowSlug: string | null = null;
    let currentStageSlug: string | null = null;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (conversation?.userId) {
      const userFlow = await prisma.userFlow.findUnique({
        where: { userId: conversation.userId },
        include: {
          flow: {
            select: { slug: true },
          },
        },
      });

      if (userFlow) {
        currentFlowSlug = userFlow.flow.slug;
        currentStageSlug = userFlow.stage;
      }
    }

    res.json({
      ok: true,
      traces,
      currentFlowSlug,
      currentStageSlug,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to get flow trace',
    });
  }
}, { protected: true });

/**
 * GET /api/admin/flows/stuck
 * Returns flows stuck in same stage for >X minutes
 */
registerRoute('get', '/api/v1/admin/flows/stuck', async (req, res) => {
  try {
    const minutes = req.query.minutes ? Number(req.query.minutes) : 30;

    const stuckFlows = await flowTracer.getStuckFlows(minutes);

    res.json({
      ok: true,
      stuckFlows,
      count: stuckFlows.length,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to get stuck flows',
    });
  }
}, { protected: true });

/**
 * GET /api/admin/flows/errors
 * Returns error frequency by stage/tool
 */
registerRoute('get', '/api/v1/admin/flows/errors', async (req, res) => {
  try {
    const errorFrequency = await flowTracer.getErrorFrequency();

    res.json({
      ok: true,
      errorFrequency,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to get error frequency',
    });
  }
}, { protected: true });

/**
 * GET /api/admin/users/:userId/flows
 * Returns all flows for a user
 */
registerRoute('get', '/api/v1/admin/users/:userId/flows', async (req, res) => {
  try {
    const { userId } = req.params;

    const userFlows = await prisma.userFlow.findMany({
      where: { userId },
      include: {
        flow: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
          },
        },
      },
    });

    const flowHistory = await prisma.flowHistory.findMany({
      where: { userId },
      include: {
        flow: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    res.json({
      ok: true,
      activeFlows: userFlows,
      completedFlows: flowHistory,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to get user flows',
    });
  }
}, { protected: true });
