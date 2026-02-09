import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';
import { insuranceRouterNextTool } from '../../../insurance/flowRouter/routerTool';

function uniqStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((x) => String(x || '').trim()).filter(Boolean)));
}

function parseProcessKeyFromFlowSlug(flowSlug: string): string | null {
  const s = String(flowSlug || '').trim();
  if (!s.startsWith('flow_')) return null;
  const key = s.slice('flow_'.length).trim();
  return key || null;
}

function isValidIsoDate(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function looksLikeMostlyDigits(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 6 && digits.length === s.replace(/\s+/g, '').length;
}

/**
 * Tool: insurance.markProcessComplete
 *
 * Marks the current modular process (flow_XX_processKey) as completed in `completed_processes`,
 * then routes to the next relevant flow using `insurance.router.next`.
 *
 * IMPORTANT: This tool must update the `userFlow` table (flowId + stage) to actually transition.
 */
export const insuranceMarkProcessCompleteTool: ToolExecutor = async (
  _payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!convo?.userId) {
      return { success: false, error: 'Conversation or user not found', errorCode: 'CONVERSATION_NOT_FOUND' };
    }

    const userFlow = await prisma.userFlow.findUnique({ where: { userId: convo.userId } });
    if (!userFlow?.flowId) {
      return { success: false, error: 'No active flow', errorCode: 'NO_ACTIVE_FLOW' };
    }

    const currentFlow = await prisma.flow.findUnique({ where: { id: userFlow.flowId }, select: { id: true, slug: true } });
    const currentFlowSlug = String(currentFlow?.slug || '').trim();
    if (!currentFlowSlug) {
      return { success: false, error: 'Current flow not found', errorCode: 'FLOW_NOT_FOUND' };
    }

    const processKey = parseProcessKeyFromFlowSlug(currentFlowSlug);
    if (!processKey) {
      return {
        success: false,
        error: `Unsupported flow slug for modular routing: ${currentFlowSlug}`,
        errorCode: 'UNSUPPORTED_FLOW_SLUG',
      };
    }

    // Use merged userData (all flows + current overlay) as the routing state.
    const mergedUserData = await flowHelpers.getUserData(convo.userId, userFlow.flowId);
    const completed = Array.isArray((mergedUserData as any).completed_processes)
      ? (mergedUserData as any).completed_processes.map(String)
      : [];

    // --- Guardrail: prevent accidental completion due to polluted fields ---
    // We observed cases where a single answer (e.g., user_id or business_name) polluted
    // many other required fields, causing a premature transition to the next flow.
    // For Flow 02 we add a deterministic sanity check and bounce back if values look invalid.
    if (processKey === '02_intent_segment_and_coverages') {
      const ud: any = mergedUserData as any;
      const businessName = String(ud.business_name ?? '').trim();

      const invalidReasons: string[] = [];
      const invalidKeys = new Set<string>();

      // business_interruption_type must be one of the questionnaire options (not digits)
      const bi = String(ud.business_interruption_type ?? '').trim();
      const allowedBI = new Set([
        'לא',
        'אובדן הכנסה (פיצוי יומי)',
        'אובדן תוצאתי (רווח גולמי)',
      ]);
      if (!bi || !allowedBI.has(bi)) {
        invalidReasons.push('business_interruption_type_invalid');
        invalidKeys.add('business_interruption_type');
      }

      // business_legal_entity_type must be one of allowed options
      const le = String(ud.business_legal_entity_type ?? '').trim();
      const allowedLE = new Set([
        'חברה פרטית',
        'עוסק מורשה',
        'עוסק זעיר',
        'שותפות רשומה',
        'חברה ציבורית',
      ]);
      if (!le || !allowedLE.has(le)) {
        invalidReasons.push('business_legal_entity_type_invalid');
        invalidKeys.add('business_legal_entity_type');
      }

      // policy_start_date must be an ISO date
      if (!isValidIsoDate(ud.policy_start_date)) {
        invalidReasons.push('policy_start_date_invalid');
        invalidKeys.add('policy_start_date');
      }

      // Address fields should not equal the business name and should not look like an ID number
      for (const k of ['business_city', 'business_street'] as const) {
        const v = String(ud[k] ?? '').trim();
        if (v && businessName && v === businessName) {
          invalidReasons.push(`${k}_equals_business_name`);
          invalidKeys.add(k);
        }
      }
      for (const k of ['business_house_number', 'business_zip', 'business_po_box'] as const) {
        const v = String(ud[k] ?? '').trim();
        if (v && looksLikeMostlyDigits(v) && v.replace(/\D/g, '').length >= 7) {
          invalidReasons.push(`${k}_looks_like_id`);
          invalidKeys.add(k);
        }
      }

      // Activity/products should be descriptive enough (avoid ultra-short placeholders like "דין")
      const act = String(ud.business_activity_and_products ?? '').trim();
      if (!act || act.length <= 3) {
        invalidReasons.push('business_activity_and_products_too_short');
        invalidKeys.add('business_activity_and_products');
      }

      // If anything looks invalid, revert/keep the user in Flow 02.
      if (invalidReasons.length > 0) {
        logger.warn('[insurance.markProcessComplete] Prevented premature completion for Flow 02; bouncing back', {
          conversationId,
          userId: convo.userId,
          currentFlowSlug,
          invalidReasons,
        });

        // Remove processKey from completed_processes (if it somehow exists already).
        const nextCompleted = uniqStrings(completed.filter((x: string) => x !== processKey));
        await flowHelpers.setUserData(convo.userId, userFlow.flowId, { completed_processes: nextCompleted }, conversationId);

        // Clear suspected polluted keys in the CURRENT flow overlay.
        // (We keep business_name as user provided it explicitly.)
        const toDelete = Array.from(invalidKeys).filter((k) => k !== 'business_name');
        if (toDelete.length > 0) {
          await prisma.userData.deleteMany({
            where: { userId: convo.userId, flowId: userFlow.flowId, key: { in: toDelete } },
          });
        }

        // Stay / return to Flow 02 main stage.
        const flow02Slug = 'flow_02_intent_segment_and_coverages';
        const flow02 = await prisma.flow.findUnique({ where: { slug: flow02Slug }, select: { id: true, definition: true } });
        if (flow02?.id) {
          const targetInitialStage = String((flow02.definition as any)?.config?.initialStage || '').trim() || 'main';
          await prisma.userFlow.update({
            where: { id: userFlow.id },
            data: { flowId: flow02.id, stage: targetInitialStage },
          });
        }

        return {
          success: true,
          data: {
            repaired: true,
            reason: 'invalid_completion_state',
            invalidReasons,
            targetFlowSlug: flow02Slug,
            targetStage: 'main',
            completed_processes: nextCompleted,
          },
        };
      }
    }

    const completed_processes = uniqStrings([...completed, processKey]);

    // Persist completion marker to the CURRENT flow (so it has precedence going forward).
    await flowHelpers.setUserData(convo.userId, userFlow.flowId, { completed_processes }, conversationId);

    // Compute next flow via router
    const routerRes = await insuranceRouterNextTool.execute(
      { ...mergedUserData, completed_processes },
      { conversationId },
    );
    if (!routerRes.success) {
      return {
        success: false,
        error: routerRes.error || 'Failed to determine next process',
        errorCode: routerRes.errorCode || 'ROUTER_FAILED',
      };
    }

    // CRITICAL product requirement:
    // Always go from Flow 01 → Flow 02 (needs discovery & coverages).
    // (Even if ask_if logic would skip it.)
    const forcedNextForWelcome01 = processKey === '01_welcome_user'
      ? 'flow_02_intent_segment_and_coverages'
      : '';

    const targetFlowSlugRaw = String(forcedNextForWelcome01 || (routerRes.data as any)?.targetFlowSlug || '').trim();
    const flowComplete = Boolean((routerRes.data as any)?.flow_complete);

    // If router says done, attempt to transition to the router flow's `done` stage for a friendly finish.
    if (flowComplete || targetFlowSlugRaw === 'done') {
      const doneFlowSlug = 'choco-clal-smb-topic-split-router';
      const doneStage = 'done';
      const doneFlow = await prisma.flow.findUnique({ where: { slug: doneFlowSlug }, select: { id: true } });

      if (doneFlow?.id) {
        await prisma.userFlow.update({
          where: { id: userFlow.id },
          data: { flowId: doneFlow.id, stage: doneStage },
        });

        logger.info('[insurance.markProcessComplete] Completed all processes, transitioned to done stage', {
          userId: convo.userId,
          fromFlow: currentFlowSlug,
          toFlow: doneFlowSlug,
          toStage: doneStage,
          completed_processes_count: completed_processes.length,
        });

        return {
          success: true,
          data: {
            flow_complete: true,
            targetFlowSlug: doneFlowSlug,
            targetStage: doneStage,
            completed_processes,
          },
        };
      }

      // Fallback: end flow by deleting the userFlow record.
      await prisma.userFlow.delete({ where: { id: userFlow.id } });
      return {
        success: true,
        data: {
          flow_complete: true,
          completed_processes,
        },
      };
    }

    if (!targetFlowSlugRaw) {
      return { success: false, error: 'Router did not return targetFlowSlug', errorCode: 'ROUTER_NO_TARGET' };
    }

    const targetFlow = await prisma.flow.findUnique({ where: { slug: targetFlowSlugRaw } });
    if (!targetFlow) {
      return { success: false, error: `Target flow not found: ${targetFlowSlugRaw}`, errorCode: 'TARGET_FLOW_NOT_FOUND' };
    }

    const targetInitialStage = String((targetFlow.definition as any)?.config?.initialStage || '').trim() || 'main';

    await prisma.userFlow.update({
      where: { id: userFlow.id },
      data: { flowId: targetFlow.id, stage: targetInitialStage },
    });

    logger.info('[insurance.markProcessComplete] Routed to next process flow', {
      userId: convo.userId,
      fromFlow: currentFlowSlug,
      toFlow: targetFlowSlugRaw,
      toStage: targetInitialStage,
      completed_processes_count: completed_processes.length,
    });

    return {
      success: true,
      data: {
        targetFlowSlug: targetFlowSlugRaw,
        targetStage: targetInitialStage,
        completed_processes,
      },
    };
  } catch (e: any) {
    logger.error('[insurance.markProcessComplete] Failed', { error: e?.message, stack: e?.stack });
    return { success: false, error: e?.message || 'Failed to mark process complete' };
  }
};
