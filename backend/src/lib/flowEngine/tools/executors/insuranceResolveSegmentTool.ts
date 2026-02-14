import { prisma } from '../../../../core';
import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';
import { resolveSegmentFromText } from '../../../insurance/segments/resolveSegmentFromText';
import { buildQuestionnaireDefaultsFromResolution } from '../../../insurance/segments/buildQuestionnaireDefaults';
import { formatBusinessSegmentLabelHe, shouldOverrideBusinessSegmentHe } from '../../../insurance/segments/formatBusinessSegmentLabelHe';

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

    const existingSegmentId = String(payload.segment_id || '').trim();
    const existingConf = Number(payload.segment_resolution_confidence);
    const existingConfOk = Number.isFinite(existingConf) ? existingConf : null;

    const resolvedSegmentId = String(resolution.segment_id || '').trim();
    const resolvedConf = Number.isFinite(resolution.match_confidence) ? resolution.match_confidence : 0;

    // Always keep a human-readable segment label for UI/search/debug.
    const desiredBusinessSegment = formatBusinessSegmentLabelHe({
      segment_name_he: resolution.segment_name_he,
      group_name_he: resolution.group_name_he,
      segment_group_id: resolution.segment_group_id,
    });
    if (desiredBusinessSegment) {
      const existing = String(payload.business_segment || '').trim();
      if (shouldOverrideBusinessSegmentHe(existing, desiredBusinessSegment)) {
        saveResults.business_segment = desiredBusinessSegment;
      }
    }

    // If we already have a segment_id but it was low-confidence, allow upgrading it.
    // This fixes early misclassifications such as "הצעת ביטוח למשרד עו״ד" accidentally matching insurance-agent.
    const allowUpgradeSegmentId = Boolean(
      resolvedSegmentId
      && resolvedSegmentId !== existingSegmentId
      && resolvedConf >= 0.75
      && (!existingSegmentId || existingConfOk === null || existingConfOk < 0.7),
    );

    for (const [k, v] of Object.entries(defaults.userData)) {
      // Always refresh resolution telemetry (source/confidence), even if a segment was resolved earlier.
      if (k === 'segment_resolution_source' || k === 'segment_resolution_confidence') {
        saveResults[k] = v;
        continue;
      }

      // Segment identifiers & names should be non-destructive (set only if missing),
      // unless we are explicitly upgrading the segment_id.
      if (allowUpgradeSegmentId && ['segment_id', 'segment_name_he', 'segment_group_id', 'segment_group_name_he', 'default_package_key'].includes(k)) {
        saveResults[k] = v;
        continue;
      }
      if (isEmpty(payload[k])) saveResults[k] = v;
    }

    if (allowUpgradeSegmentId) {
      // Ensure the UI label aligns immediately with the upgraded segment.
      if (desiredBusinessSegment) saveResults.business_segment = desiredBusinessSegment;
      // Re-run segment coverages prefill on the next Flow02 pass with the corrected segment_id.
      saveResults.segment_coverages_prefilled_v1 = false;
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
