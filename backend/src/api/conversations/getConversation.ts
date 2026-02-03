import { Request, Response } from 'express';
import { FlowHistory, OrganisationInfo } from '@prisma/client';
import { registerRoute } from '../../utils/routesRegistry';
import { flowHelpers } from '../../lib/flowEngine/flowHelpers';
import { prisma } from '../../core';
import { FlowDefinition } from '../../lib/flowEngine';
import { logger } from '../../utils/logger';

registerRoute('get', '/api/v1/conversations/:id', async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ ok: false, error: 'Conversation not found' });
      return;
    }

    let userData: any = {};
    let flowState: any = null;
    let organisations: OrganisationInfo[] = [];
    if (conversation.userId) {
      const userFlow = await prisma.userFlow.findUnique({ where: { userId: conversation.userId } });
      const flowId = userFlow?.flowId || '';
      const flow = await prisma.flow.findUnique({ where: { id: flowId } });

      if (flow) {
        const flowDefinition = flow.definition as FlowDefinition;
        userData = await flowHelpers.getUserData(conversation.userId, flowId);
        userData = flowHelpers.sanitizeData(userData, flowDefinition.fields);

        flowState = { name: flow.name, stages: [] };
        Object.entries((flow.definition as FlowDefinition).stages).forEach(([stageSlug, stage]) => {
          flowState.stages.push({
            stageSlug,
            isComplete: stage.fieldsToCollect.every((fieldSlug) => (
              fieldSlug in userData
              && userData[fieldSlug] !== undefined
              && userData[fieldSlug] !== null
              && userData[fieldSlug] !== ''
            )),
          });
        });
      }
    }

    const sessions = new Map<string, FlowHistory[]>();
    let activeFlow: FlowState | null = null;
    const completedFlows: FlowState[] = [];
    if (conversation.userId) {
      const relatedOrganisations = await prisma.userOrganisation.findMany({ where: { userId: conversation.userId } });
      if (relatedOrganisations.length) {
        organisations = await prisma.organisationInfo.findMany({
          where: { id: { in: relatedOrganisations.map((o) => o.organisationId) } },
        });
      }

      const userFlow = await prisma.userFlow.findUnique({ where: { userId: conversation.userId } });
      const flowId = userFlow?.flowId;

      userData = await flowHelpers.getUserData(conversation.userId, flowId);

      const flowHistory = await prisma.flowHistory.findMany({ where: { userId: conversation.userId } });
      flowHistory.forEach((flowHistoryItem) => {
        const sessionHistory = sessions.get(flowHistoryItem.sessionId) || [];
        sessionHistory.push(flowHistoryItem);
        sessions.set(flowHistoryItem.sessionId, sessionHistory);
      });

      // Group flowHistory by flowId to find all flows the user has been through
      const flowsByFlowId = new Map<string, { flowId: string; sessionId: string; stages: string[] }>();

      for (const [sessionId, session] of [...sessions.entries()]) {
        if (!session || session.length === 0) continue;

        // Iterate through all history items to find all unique flowIds in this session
        session.forEach((s) => {
          const { flowId } = s;
          if (!flowsByFlowId.has(flowId)) {
            flowsByFlowId.set(flowId, {
              flowId,
              sessionId,
              stages: [],
            });
          }

          const flowData = flowsByFlowId.get(flowId)!;
          if (!flowData.stages.includes(s.stage)) {
            flowData.stages.push(s.stage);
          }
        });
      }

      if (userFlow) {
        const flow = (await prisma.flow.findUnique({ where: { id: userFlow.flowId } }))!;
        const currentFlowStages = Object.entries((flow.definition as FlowDefinition).stages).map(([stageSlug, stage]) => ({
          slug: stageSlug,
          name: stage.name,
          isCompleted: !!sessions.get(userFlow.id)?.some((s) => s.stage === stageSlug),
        }));
        const allStagesCompleted = currentFlowStages.every((s) => s.isCompleted);

        activeFlow = {
          name: flow.name,
          slug: flow.slug,
          stages: currentFlowStages,
          sessionId: userFlow.id,
          isCompleted: allStagesCompleted,
        };
      }

      // Process all flows the user has been through
      for (const [flowId, flowData] of flowsByFlowId.entries()) {
        const flow = await prisma.flow.findUnique({ where: { id: flowId } });
        if (!flow) continue;

        const flowDefinition = flow.definition as FlowDefinition;
        const flowStages = Object.entries(flowDefinition.stages).map(([stageSlug, stage]) => ({
          slug: stageSlug,
          name: stage.name,
          isCompleted: flowData.stages.includes(stageSlug),
        }));

        // Check if flow is completed by checking if ANY visited stage is a terminal stage (no nextStage)
        // AND not explicitly a transition stage
        const isCompleted = flowStages.some((s) => {
          if (!s.isCompleted) return false;

          const stageDef = flowDefinition.stages[s.slug];
          if (!stageDef) return false;

          // Check if terminal (no nextStage)
          const isTerminal = !stageDef.nextStage;

          // Check if explicit transition (slug contains 'transition')
          // If it's a transition, it's NOT a "completion" in the happy path sense
          const isExplicitTransition = s.slug.toLowerCase().includes('transition');

          return isTerminal && !isExplicitTransition;
        });

        const allStagesCompleted = isCompleted; // Use the new logic
        const isCurrentFlow = userFlow?.flowId === flowId;

        // Add to completedFlows ONLY if it's NOT the current active flow
        // (The current flow will be in activeFlow)
        if (!isCurrentFlow) {
          // Check if already added
          const alreadyAdded = completedFlows.some((f) => f.slug === flow.slug && f.sessionId === flowData.sessionId);
          if (!alreadyAdded) {
            completedFlows.push({
              name: flow.name,
              slug: flow.slug,
              stages: flowStages,
              sessionId: flowData.sessionId,
              isCompleted: allStagesCompleted,
            });
          }
        }
      }
    }

    res.json({
      ok: true,
      conversation,
      userData,
      activeFlow,
      completedFlows,
      organisations,
      user: conversation.userId
        ? await prisma.user.findUnique({ where: { id: conversation.userId } })
        : null,
      log: await prisma.apiCall.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' } }),
    });
  } catch (error: any) {
    logger.error('Failed to get conversation:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get conversation',
      message: error.message,
    });
  }
}, { protected: true });

type FlowState = {
  name: string;
  slug: string;
  stages: Array<{
    slug: string;
    name?: string;
    isCompleted: boolean;
  }>;
  sessionId: string;
  isCompleted: boolean;
}
