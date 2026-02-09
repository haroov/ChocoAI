import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { flowHelpers } from '../../lib/flowEngine/flowHelpers';

type UiFlowStage = {
  slug: string;
  name?: string;
  isCompleted: boolean;
};

type UiFlow = {
  name: string;
  slug: string;
  isCompleted: boolean;
  sessionId: string;
  stages: UiFlowStage[];
};

const buildStages = (definition: any, completedStageSlugs: Set<string>): UiFlowStage[] => {
  const stagesObj = definition?.stages || {};
  return Object.entries(stagesObj).map(([stageSlug, stageDef]: any) => ({
    slug: stageSlug,
    name: stageDef?.name,
    isCompleted: completedStageSlugs.has(stageSlug),
  }));
};

registerRoute('get', '/api/v1/conversations/:id', async (req: Request, res: Response) => {
  try {
    const idRaw = (req.params as any).id as unknown;
    const id = Array.isArray(idRaw) ? String(idRaw[0] || '').trim() : String(idRaw || '').trim();

    if (!id) {
      res.status(400).json({
        ok: false,
        error: 'Missing conversation ID',
      });
      return;
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        user: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, content: true, createdAt: true, role: true },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({
        ok: false,
        error: 'Conversation not found',
      });
      return;
    }

    const userId = conversation.userId || null;

    // ---- userData (prefer active flow overlay if known) ----
    let userData: Record<string, unknown> = {};
    let activeFlow: UiFlow | null = null;
    const completedFlows: UiFlow[] = [];

    if (userId) {
      const activeUserFlow = await prisma.userFlow.findUnique({
        where: { userId },
        include: {
          flow: { select: { id: true, name: true, slug: true, definition: true } },
        },
      });

      // If no active flow, use last known flow from history for overlay precedence.
      const overlayFlowId = activeUserFlow?.flow?.id
        || (await prisma.flowHistory.findFirst({
          where: { userId },
          orderBy: { completedAt: 'desc' },
          select: { flowId: true },
        }))?.flowId;

      userData = await flowHelpers.getUserData(userId, overlayFlowId);

      // Auto-repair: if the stored first name is a greeting (e.g., "הי"),
      // infer the real name from the conversation's user messages and persist it.
      try {
        const bad = new Set(['הי', 'היי', 'שלום', 'אהלן', 'הלו', 'hi', 'hello', 'hey']);
        const first = String((userData as any).user_first_name || (userData as any).first_name || '').trim();
        const lowered = first.toLowerCase();
        const needsRepair = first && (bad.has(lowered) || lowered === 'לקוח');
        if (needsRepair) {
          const texts = (conversation.messages || [])
            .filter((m) => m.role === 'user')
            .map((m) => String(m.content || ''))
            .filter(Boolean);
          const joined = texts.join(' | ');
          // Best-effort: find "<first> <last>" near phone or comma segments.
          const m = joined.match(/(?:^|[,\n|]\s*)([\u0590-\u05FF]{2,})\s+([\u0590-\u05FF]{2,})(?=\s*(?:[,\n|]|$))/);
          const inferredFirst = m ? String(m[1] || '').trim() : '';
          const inferredLast = m ? String(m[2] || '').trim() : '';
          if (inferredFirst && inferredFirst !== first) {
            await flowHelpers.setUserData(userId, overlayFlowId || activeUserFlow?.flow?.id || '', {
              first_name: inferredFirst,
              ...(inferredLast ? { last_name: inferredLast } : {}),
            }, conversation.id);
            // Refresh local snapshot for response
            userData = await flowHelpers.getUserData(userId, overlayFlowId);
          }
        }
      } catch {
        // best-effort
      }

      // ---- active flow ----
      if (activeUserFlow?.flow) {
        const completedStageRows = await prisma.flowHistory.findMany({
          where: {
            userId,
            flowId: activeUserFlow.flow.id,
            sessionId: activeUserFlow.id,
          },
          select: { stage: true },
        });
        const completedStageSlugs = new Set(completedStageRows.map((r) => r.stage));

        activeFlow = {
          name: activeUserFlow.flow.name,
          slug: activeUserFlow.flow.slug,
          isCompleted: false,
          sessionId: activeUserFlow.id,
          stages: buildStages(activeUserFlow.flow.definition, completedStageSlugs),
        };
      }

      // ---- completed flows (history) ----
      const historyRows = await prisma.flowHistory.findMany({
        where: { userId },
        include: {
          flow: { select: { id: true, name: true, slug: true, definition: true } },
        },
        orderBy: { completedAt: 'desc' },
      });

      // Group by sessionId + flowId (a "flow run")
      const grouped = new Map<string, { flow: any; stages: Set<string> }>();
      for (const row of historyRows) {
        const key = `${row.sessionId}::${row.flowId}`;
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, { flow: row.flow, stages: new Set([row.stage]) });
        } else {
          existing.stages.add(row.stage);
        }
      }

      for (const [key, group] of grouped.entries()) {
        const [sessionId] = key.split('::');
        const allStages = buildStages(group.flow?.definition, group.stages);
        const totalStages = allStages.length;
        const completedCount = allStages.filter((s) => s.isCompleted).length;

        completedFlows.push({
          name: group.flow?.name || group.flow?.slug || 'Flow',
          slug: group.flow?.slug || 'flow',
          isCompleted: totalStages > 0 ? completedCount === totalStages : false,
          sessionId,
          stages: allStages,
        });
      }
    }

    const logRows = await prisma.apiCall.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        provider: true,
        request: true,
        response: true,
        latencyMs: true,
        createdAt: true,
      },
    });

    const organisations = userId
      ? (await prisma.userOrganisation.findMany({
        where: { userId },
        include: { organisation: true },
      })).map((row) => ({
        id: row.organisation.id,
        region: row.organisation.region,
        einOrRegNum: row.organisation.einOrRegNum,
        data: row.organisation.data as Record<string, unknown>,
      }))
      : [];

    res.json({
      ok: true,
      user: conversation.user || undefined,
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages,
      },
      userData,
      activeFlow,
      completedFlows,
      log: logRows.map((row) => ({
        id: row.id,
        provider: row.provider,
        request: row.request,
        response: row.response,
        latencyMs: row.latencyMs || 0,
        createdAt: row.createdAt.toISOString(),
      })),
      organisations,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch conversation',
      message: error?.message,
    });
  }
}, { protected: true });
