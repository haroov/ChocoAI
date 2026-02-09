import { prisma } from '../../../../core';
import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';
import { resolveSegmentFromText } from '../../../insurance/segments/resolveSegmentFromText';
import { buildQuestionnaireDefaultsFromResolution } from '../../../insurance/segments/buildQuestionnaireDefaults';

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function buildCombinedSegmentText(payload: Record<string, unknown>): string {
  const parts = [
    payload.business_segment,
    payload.segment_description,
    payload.segment_name_he,
    payload.segment_group_name_he,
    payload.industry,
    payload.activity_description,
    // Topic-split questionnaire fields (02_intent_segment_and_coverages)
    payload.business_used_for,
    payload.business_activity_and_products,
    payload.business_occupation,
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  // Prefer a single combined string for deterministic matching
  return parts.join(' | ');
}

/**
 * insurance.resolveSegment
 * Resolves segment/group from free text and applies non-destructive defaults.
 */
export const insuranceResolveSegmentTool: ToolExecutor = async (
  payload: Record<string, unknown>,
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

    const combined = buildCombinedSegmentText(payload);
    if (!combined) {
      return { success: true, data: { resolved: false, reason: 'no_text' } };
    }

    const resolution = await resolveSegmentFromText(combined, { conversationId });
    const defaults = buildQuestionnaireDefaultsFromResolution(resolution);

    // Apply non-destructively (fill only if missing)
    const saveResults: Record<string, unknown> = {};

    // Always keep a human-readable segment label for UI/search/debug.
    const desiredBusinessSegment = String(resolution.segment_name_he || resolution.group_name_he || '').trim();
    if (desiredBusinessSegment) {
      const existing = String(payload.business_segment || '').trim();
      const shouldOverride = !existing
        || existing.length < desiredBusinessSegment.length
        || desiredBusinessSegment.includes(existing);
      if (shouldOverride) saveResults.business_segment = desiredBusinessSegment;
    }

    for (const [k, v] of Object.entries(defaults.userData)) {
      // Always refresh resolution telemetry (source/confidence), even if a segment was resolved earlier.
      if (k === 'segment_resolution_source' || k === 'segment_resolution_confidence') {
        saveResults[k] = v;
        continue;
      }

      // Segment identifiers & names should be non-destructive (set only if missing).
      if (isEmpty(payload[k])) saveResults[k] = v;
    }
    for (const [k, v] of Object.entries(defaults.prefill)) {
      if (isEmpty(payload[k])) saveResults[k] = v;
    }

    // If nothing to save, still return resolution for telemetry
    if (Object.keys(saveResults).length === 0) {
      return {
        success: true,
        data: {
          resolved: resolution.source !== 'none',
          confidence: resolution.match_confidence,
          segment_id: resolution.segment_id || null,
          segment_group_id: resolution.segment_group_id || null,
        },
      };
    }

    await flowHelpers.setUserData(convo.userId, userFlow.flowId, saveResults, conversationId);

    return {
      success: true,
      data: {
        resolved: resolution.source !== 'none',
        confidence: resolution.match_confidence,
        segment_id: resolution.segment_id || null,
        segment_group_id: resolution.segment_group_id || null,
      },
      saveResults,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to resolve segment' };
  }
};
