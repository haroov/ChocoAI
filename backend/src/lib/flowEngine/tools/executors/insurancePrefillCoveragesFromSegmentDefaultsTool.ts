import { ToolExecutor, ToolResult } from '../types';
import { getSegmentsCatalogProd } from '../../../insurance/segments/loadSegmentsCatalog';
import { prisma } from '../../../../core/prisma';

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function hasAnyBooleanValues(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj as Record<string, unknown>).some((v) => typeof v === 'boolean');
}

function hasStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.some((x) => typeof x === 'string' && x.trim());
}

function deriveCoveragesFromSegmentMeta(seg: any): Record<string, boolean> {
  // Fallback logic used when `seg.coverages` is missing.
  // Motivation: Flow02 should still behave deterministically (ask only relevant coverages)
  // even if the admin catalog hasn't been enriched yet.
  //
  // We keep this conservative and segment-group oriented; admin overrides (seg.coverages) still win when present.
  const out: Record<string, boolean> = {};

  const groupId = String(seg?.segment_group_id || '').trim();
  const hasPhysical = seg?.business_profile_defaults?.has_physical_location === true;

  const relevantTypes: string[] = hasStringList(seg?.relevant_insurance_types)
    ? (seg.relevant_insurance_types as string[]).map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const recommendedProducts: Array<{ product_key?: string }> = Array.isArray(seg?.recommended_products)
    ? seg.recommended_products
    : [];

  const hasCyberSignal = relevantTypes.includes('cyber_optional')
    || recommendedProducts.some((p) => String(p?.product_key || '').trim() === 'clal_cyber');

  // Professional offices default subset (lawyers, real-estate brokerage, accountants, etc.)
  // - Property contents + electronic equipment are common
  // - 3rd party + employers are common (employers will still be gated by has_employees ask_if)
  // - Cyber is optional but often relevant in offices (signal-based)
  if (groupId === 'professional_offices') {
    // Property
    out.contents = Boolean(hasPhysical); // ask contents only if they have a physical location
    out.stock = false;
    out.building = false;
    out.burglary = false;
    out.money = false;
    out.transit = false;
    out.electronic_equipment = true;

    // Liability
    out.third_party = true;
    out.employers_liability = true;
    out.product_liability = false;

    // Annexes
    out.cyber = Boolean(hasCyberSignal);
    out.terror = false;

    // BI
    out.business_interruption_daily_compensation = false;
  }

  return out;
}

function resolveCanonicalSegmentId(segmentId?: string): string | undefined {
  const id = String(segmentId || '').trim();
  if (!id) return undefined;
  const catalog = getSegmentsCatalogProd();
  let seg: any = catalog.segments.find((s: any) => s.segment_id === id);
  let guard = 0;
  while (seg?.duplicate_of && guard < 5) {
    const next = catalog.segments.find((s: any) => s.segment_id === seg.duplicate_of);
    if (!next || next === seg) break;
    seg = next;
    guard += 1;
  }
  return String(seg?.segment_id || id).trim() || undefined;
}

/**
 * insurance.prefillCoveragesFromSegmentDefaults
 *
 * Enforces Flow02 behavior:
 * - Only coverages marked as default=true on the resolved segment remain eligible to be asked.
 * - All non-default coverages are forced to `false` (even if previously set).
 *
 * This tool is intended to run at Flow02 entry, before the question bank is applied.
 */
export const insurancePrefillCoveragesFromSegmentDefaultsTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const segmentId = resolveCanonicalSegmentId(String(payload.segment_id || '').trim());
    if (!segmentId) {
      return { success: true, data: { ok: true, skipped: true, reason: 'no_segment_id' } };
    }

    const catalog = getSegmentsCatalogProd();
    const seg: any = catalog.segments.find((s: any) => s.segment_id === segmentId);
    const rawCoverages = (seg?.coverages && typeof seg.coverages === 'object') ? (seg.coverages as Record<string, unknown>) : null;
    const derivedCoverages = deriveCoveragesFromSegmentMeta(seg);
    const coverages = (rawCoverages && hasAnyBooleanValues(rawCoverages))
      ? rawCoverages
      : (hasAnyBooleanValues(derivedCoverages) ? derivedCoverages : null);
    if (!coverages) {
      // If we cannot derive any signal, do nothing (avoid forcing all questions off).
      return { success: true, data: { ok: true, skipped: true, reason: 'no_configured_coverages', segment_id: segmentId } };
    }

    const wantsContents = asBool((coverages as any).contents) === true;
    const wantsStockRaw = asBool((coverages as any).stock) === true;
    // Business rule: Stock (inventory) coverage is only eligible if Contents is eligible.
    // (E.g., a retail shop cannot buy stock coverage without contents coverage.)
    const wantsStock = wantsContents && wantsStockRaw;
    const wantsBusinessInterruptionDaily = asBool((coverages as any).business_interruption_daily_compensation) === true;

    const allow: Record<string, boolean> = {
      // Split chapter-1 selection into two independent questions:
      // - contents/equipment (excludes stock)
      // - stock (inventory)
      ch1_contents_selected: wantsContents,
      ch1_stock_selected: wantsStock,
      ch2_building_selected: asBool((coverages as any).building) === true,
      ch3a_selected: wantsBusinessInterruptionDaily,
      ch4_burglary_selected: asBool((coverages as any).burglary) === true,
      ch5_money_selected: asBool((coverages as any).money) === true,
      ch6_transit_selected: asBool((coverages as any).transit) === true,
      ch7_third_party_selected: asBool((coverages as any).third_party) === true,
      ch8_employers_selected: asBool((coverages as any).employers_liability) === true,
      ch9_product_selected: asBool((coverages as any).product_liability) === true,
      ch10_electronic_selected: asBool((coverages as any).electronic_equipment) === true,
      cyber_selected: asBool((coverages as any).cyber) === true,
      terror_selected: asBool((coverages as any).terror) === true,
    };

    const saveResults: Record<string, unknown> = {};

    // Mark one-time application (used by Flow02 entry stage condition).
    if (payload.segment_coverages_prefilled_v1 !== true) saveResults.segment_coverages_prefilled_v1 = true;

    // IMPORTANT product logic (Flow02 expectation):
    // - Segment-selected (allowed=true) coverages should remain *unanswered* in userData,
    //   so Flow02 asks them (user answers true/false).
    // - Segment-unselected (allowed=false) coverages are forced to false so Flow02 skips them.
    //
    // Since core `setUserData` skips null/undefined and doesn't allow clearing booleans to null,
    // we delete stale "false" defaults for allowed coverages directly from DB (across flows),
    // so the field becomes missing/undefined at read-time.
    try {
      const convo = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });
      if (convo?.userId) {
        const allowedCoverageKeys = Object.entries(allow)
          .filter(([_k, isAllowed]) => isAllowed)
          .map(([k]) => k);

        // Clear boolean=false defaults for allowed coverages (so Flow02 asks them).
        if (allowedCoverageKeys.length > 0) {
          await prisma.userData.deleteMany({
            where: {
              userId: convo.userId,
              key: { in: allowedCoverageKeys },
              type: 'boolean',
              value: 'false',
            },
          });
        }

        // Same for business interruption: if it's allowed by the segment, but currently stored as "לא",
        // clear it so the Flow02 question is asked.
        if (wantsBusinessInterruptionDaily) {
          await prisma.userData.deleteMany({
            where: {
              userId: convo.userId,
              key: 'business_interruption_type',
              type: 'string',
              value: 'לא',
            },
          });
        }
      }
    } catch {
      // best-effort; never block flow
    }

    // Business interruption (daily compensation) is represented by `business_interruption_type` in Flow02.
    // If not allowed by segment defaults, force it to "לא" so the question is skipped and downstream BI processes remain off.
    if (!wantsBusinessInterruptionDaily && payload.business_interruption_type !== 'לא') {
      saveResults.business_interruption_type = 'לא';
    }

    // Product-liability gating question:
    // If product liability is not relevant by segment defaults, mark has_products_activity=false
    // so we skip both the gating question and downstream product-liability coverage question.
    // Exception: if the user already explicitly signaled product activity/coverage, do not force it off.
    try {
      const productAllowed = allow.ch9_product_selected === true;
      const userAlreadyAskedForProduct = payload.ch9_product_selected === true || payload.has_products_activity === true;

      if (!productAllowed && !userAlreadyAskedForProduct && payload.has_products_activity !== false) {
        saveResults.has_products_activity = false;
      }

      // If product is allowed, ensure we don't carry a stale `false` that would suppress asking.
      if (productAllowed && payload.has_products_activity === false) {
        // Best-effort: delete persisted false so the gating question can be asked.
        const convo = await prisma.conversation.findUnique({
          where: { id: conversationId },
          select: { userId: true },
        });
        if (convo?.userId) {
          await prisma.userData.deleteMany({
            where: {
              userId: convo.userId,
              key: 'has_products_activity',
              type: 'boolean',
              value: 'false',
            },
          });
        }
      }
    } catch {
      // best-effort
    }

    // Enforce: any non-allowed coverage is forced off, so Flow02 won't ask about it.
    // Persist the false explicitly (even if the current payload already says false),
    // because the model's question selection depends on values actually stored in userData.
    // Exception: if the user explicitly asked for the coverage and it was set true, do not override.
    for (const [fieldKey, isAllowed] of Object.entries(allow)) {
      if (!isAllowed && payload[fieldKey] !== true) {
        saveResults[fieldKey] = false;
      }
    }

    if (Object.keys(saveResults).length === 0) {
      return { success: true, data: { ok: true, segment_id: segmentId, noop: true } };
    }

    return {
      success: true,
      data: { ok: true, segment_id: segmentId },
      saveResults,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to prefill coverages from segment defaults' };
  }
};

