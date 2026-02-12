import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { flowHelpers } from '../../lib/flowEngine/flowHelpers';
import { parsePolicyStartDateToYmd } from '../../lib/flowEngine/utils/dateTimeUtils';

type UiFlowStage = {
  slug: string;
  name?: string;
  description?: string;
  isCompleted: boolean;
  fieldsToCollect: string[];
  kind: 'user' | 'system' | 'error';
};

type UiFlow = {
  name: string;
  slug: string;
  isCompleted: boolean;
  sessionId: string;
  stages: UiFlowStage[];
};

type UiFieldProvenance = {
  ts: string | null;
  contributor: 'user' | 'system';
  flowSlug?: string;
  stageSlug?: string;
  traceId?: string;
  method: 'fieldsCollected' | 'snapshot';
};

const buildStages = (definition: any, completedStageSlugs: Set<string>): UiFlowStage[] => {
  const stagesObj = definition?.stages || {};

  const sortFieldsByUiPolicy = (fieldSlugs: string[]): string[] => {
    const mode = String(definition?.config?.ui?.fieldsSort || '').trim();
    if (mode !== 'priorityAsc') return fieldSlugs;
    const fields = definition?.fields || {};
    const pr = (slug: string): number => {
      const n = Number(fields?.[slug]?.priority);
      return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    };
    return [...fieldSlugs].sort((a, b) => {
      const ap = pr(a);
      const bp = pr(b);
      if (ap !== bp) return ap - bp;
      return String(a).localeCompare(String(b));
    });
  };

  const inferKind = (stageSlug: string, stageDef: any): UiFlowStage['kind'] => {
    const slug = String(stageSlug || '').trim().toLowerCase();
    if (slug === 'error') return 'error';
    if (['route', 'resolvesegment', 'decidenextstep'].includes(slug)) return 'system';

    const desc = String(stageDef?.description || '').trim();
    if (/^system\s*:/i.test(desc)) return 'system';

    const prompt = String(stageDef?.prompt || '').trim();
    if (/CRITICAL:\s*This stage should NOT generate a response message\./i.test(prompt)) return 'system';

    return 'user';
  };

  const extractRequiredFields = (stageDef: any): string[] => {
    const cond = String(stageDef?.orchestration?.customCompletionCheck?.condition || '').trim();
    if (!cond) return Array.isArray(stageDef?.fieldsToCollect) ? stageDef.fieldsToCollect : [];

    const out = new Set<string>();
    const re = /__present\s*\(\s*userData\.([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
    for (const match of cond.matchAll(re)) {
      if (match?.[1]) out.add(String(match[1]));
    }
    return Array.from(out);
  };

  return Object.entries(stagesObj)
    .map(([stageSlug, stageDef]: any) => {
      const kind = inferKind(stageSlug, stageDef);
      return ({
        slug: stageSlug,
        name: stageDef?.name,
        description: stageDef?.description,
        isCompleted: completedStageSlugs.has(stageSlug),
        fieldsToCollect: sortFieldsByUiPolicy(extractRequiredFields(stageDef)),
        kind,
      });
    })
    // Hide internal/system/error stages in UI (as requested).
    .filter((s) => s.kind === 'user');
};

const isPresentValue = (v: unknown): boolean => {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return false;
    const lowered = s.toLowerCase();
    if (
      lowered === 'null'
      || lowered === ':null'
      || lowered === 'undefined'
      || lowered === ':undefined'
    ) return false;
    return true;
  }
  if (Array.isArray(v)) return v.length > 0;
  // boolean false is a valid answer
  return true;
};

const contributorFromStageSlug = (stageSlug: string | null | undefined): UiFieldProvenance['contributor'] => {
  const slug = String(stageSlug || '').trim().toLowerCase();
  if (!slug) return 'system';
  if (slug === 'error') return 'system';
  if (['route', 'resolvesegment', 'decidenextstep', 'prefillcoverages'].includes(slug)) return 'system';
  return 'user';
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
        const last = String((userData as any).user_last_name || (userData as any).last_name || '').trim();
        const lowered = first.toLowerCase();
        const referralTokens = new Set([
          'גוגל', 'google',
          'פייסבוק', 'facebook',
          'אינסטגרם', 'instagram',
          'טיקטוק', 'tiktok',
          'לינקדאין', 'linkedin',
          'המלצה', 'recommendation',
          'סוכן', 'agent',
        ]);
        const referral = String((userData as any).referral_source || '').trim();
        const needsRepair = first && (
          bad.has(lowered)
          || lowered === 'לקוח'
          || (referral && referral === first && referralTokens.has(lowered))
        );
        const missingLastName = !!first && !last;

        if (needsRepair || missingLastName) {
          const texts = (conversation.messages || [])
            .filter((m) => m.role === 'user')
            .map((m) => String(m.content || ''))
            .filter(Boolean);
          const joined = texts.join(' | ');
          // Best-effort: find "<first> <last>" near phone or comma segments.
          const m = joined.match(/(?:^|[,\n|]\s*)([\u0590-\u05FF]{2,})\s+([\u0590-\u05FF]{2,})(?=\s*(?:[,\n|]|$))/);
          const inferredFirst = m ? String(m[1] || '').trim() : '';
          const inferredLast = m ? String(m[2] || '').trim() : '';
          const shouldRepairMissingLast = missingLastName && inferredFirst && inferredLast && (
            first === inferredLast || inferredFirst !== first
          );
          if ((needsRepair || shouldRepairMissingLast) && inferredFirst && inferredFirst !== first) {
            await flowHelpers.setUserData(userId, overlayFlowId || activeUserFlow?.flow?.id || '', {
              first_name: inferredFirst,
              ...(inferredLast ? { last_name: inferredLast } : {}),
            }, conversation.id);
            // Refresh local snapshot for response
            userData = await flowHelpers.getUserData(userId, overlayFlowId);
          } else if (shouldRepairMissingLast && inferredLast) {
            // Only set missing last name if first name looks plausible but last name is missing.
            await flowHelpers.setUserData(userId, overlayFlowId || activeUserFlow?.flow?.id || '', {
              last_name: inferredLast,
            }, conversation.id);
            userData = await flowHelpers.getUserData(userId, overlayFlowId);
          }
        }
      } catch {
        // best-effort
      }

      // Auto-repair: if policy_start_date is missing (or non-ISO),
      // infer it from the conversation pair (assistant asks for start date → user replies),
      // normalize to YYYY-MM-DD, and persist it.
      // This fixes cases where extraction missed the field but the assistant moved on.
      try {
        const current = String((userData as any).policy_start_date ?? '').trim();
        const hasIso = /^\d{4}-\d{2}-\d{2}$/.test(current);
        if (!hasIso && Array.isArray(conversation.messages) && conversation.messages.length > 0) {
          const msgs = conversation.messages as Array<{ role: string; content: string }>;
          const isAsk = (assistantText: string): boolean => (
            /מאיזה\s*תאריך|תאריך\s*תחילת|שהביטוח\s*יתחיל|הביטוח\s*יתחיל|effective\s*date|start\s*date/i.test(String(assistantText || ''))
          );
          let replyText: string | null = null;
          for (let i = 0; i < msgs.length - 1; i += 1) {
            if (msgs[i].role !== 'assistant') continue;
            if (!isAsk(msgs[i].content || '')) continue;
            const next = msgs[i + 1];
            if (next?.role === 'user' && String(next.content || '').trim()) {
              replyText = String(next.content || '').trim();
            }
          }
          if (replyText) {
            const iso = await parsePolicyStartDateToYmd(replyText, 'Asia/Jerusalem');
            if (iso) {
              await flowHelpers.setUserData(
                userId,
                overlayFlowId || activeUserFlow?.flow?.id || '',
                { policy_start_date: iso },
                conversation.id,
              );
              userData = await flowHelpers.getUserData(userId, overlayFlowId);
            }
          }
        }
      } catch {
        // best-effort
      }

      // Auto-repair: prevent business registration ID (ח"פ/ע"מ) from polluting address fields.
      // If we detect address fields that look like the registration ID (or a reg-id-like numeric token),
      // clear them (and best-effort re-infer from message context).
      try {
        const digitsOnly = (val: unknown): string => String(val ?? '').replace(/\D/g, '');
        const isMostlyDigitsToken = (raw: string): boolean => {
          const s = String(raw || '').trim();
          if (!s) return false;
          const digits = digitsOnly(s);
          return digits.length >= 6 && digits.length === s.replace(/\s+/g, '').length;
        };
        const looksLikeBusinessRegId = (raw: string): boolean => {
          const s = String(raw || '').trim();
          if (!s) return false;
          const digits = digitsOnly(s);
          return isMostlyDigitsToken(s) && digits.length >= 8 && digits.length <= 10;
        };
        const hasHebrewLetters = (raw: string): boolean => /[\u0590-\u05FF]/.test(String(raw || ''));

        const regDigits = digitsOnly((userData as any).business_registration_id);
        const addressKeys = ['business_city', 'business_street', 'business_house_number', 'business_zip', 'business_po_box'] as const;
        const otherKeys = ['business_interruption_type', 'business_additional_locations_count', 'policy_start_date'] as const;

        const isPollutedAddressValue = (rawVal: unknown): boolean => {
          const v = String(rawVal ?? '').trim();
          if (!v) return false;
          const vDigits = digitsOnly(v);
          if (regDigits && vDigits && vDigits === regDigits && looksLikeBusinessRegId(v)) return true;
          // Even if business_registration_id is missing, treat a reg-id-like value as suspicious for address fields.
          return looksLikeBusinessRegId(v);
        };

        const shouldRepairAddress = addressKeys.some((k) => isPollutedAddressValue((userData as any)[k]));
        const shouldRepairOther = otherKeys.some((k) => {
          const v = String((userData as any)[k] ?? '').trim();
          if (!v) return false;
          const vDigits = digitsOnly(v);
          if (regDigits && vDigits && vDigits === regDigits && looksLikeBusinessRegId(v)) return true;
          // policy_start_date should be ISO YYYY-MM-DD; if it looks like a reg-id-like token, it is polluted.
          if (k === 'policy_start_date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
          return looksLikeBusinessRegId(v);
        });

        if ((shouldRepairAddress || shouldRepairOther) && Array.isArray(conversation.messages) && conversation.messages.length > 0) {
          // Best-effort re-inference from message pairs (assistant prompt → user reply).
          const inferred: Partial<Record<(typeof addressKeys)[number] | 'business_registration_id', string>> = {};
          const splitParts = (text: string): string[] => (
            String(text || '')
              .split(/\r?\n|,/g)
              .map((x) => x.trim())
              .filter(Boolean)
          );

          const setIfGood = (key: keyof typeof inferred, value: string) => {
            if (inferred[key]) return;
            const v = String(value || '').trim();
            if (!v) return;
            if (looksLikeBusinessRegId(v)) return;
            if (key === 'business_city' && !hasHebrewLetters(v)) return;
            if (key === 'business_street' && !hasHebrewLetters(v)) return;
            if (key === 'business_house_number') {
              const d = digitsOnly(v);
              if (!d || d.length > 5) return;
              inferred.business_house_number = d;
              return;
            }
            if (key === 'business_zip') {
              const d = digitsOnly(v);
              if (!d || d.length < 5 || d.length > 7) return;
              inferred.business_zip = d;
              return;
            }
            if (key === 'business_po_box') {
              const d = digitsOnly(v);
              if (!d || d.length > 7) return;
              inferred.business_po_box = d;
              return;
            }
            inferred[key] = v;
          };

          const assistantAsked = (assistantText: string) => {
            const t = String(assistantText || '');
            return ({
              reg: /ח[\"״׳']?פ|ע[\"״׳']?מ|מספר\s*(?:רישום|ח\.פ|ע\.מ)|מספר\s*ת\.?ז/i.test(t),
              city: /נא לציין יישוב|יישוב|עיר/i.test(t),
              street: /נא לציין רחוב|רחוב/i.test(t),
              house: /מס['\"״׳]?\s*בית|מספר\s*בית/i.test(t),
              zip: /מיקוד/i.test(t),
              pobox: /ת\.?[\"״׳']?ד|תיבת\s*דואר|תא\s*דואר|po\s*box/i.test(t),
            });
          };

          const msgs = conversation.messages as Array<{ role: string; content: string }>;
          for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (m.role !== 'user') continue;
            const userText = String(m.content || '').trim();
            if (!userText) continue;

            // Find nearest preceding assistant message (usually immediately previous).
            let j = i - 1;
            while (j >= 0 && msgs[j].role !== 'assistant') j--;
            if (j < 0) continue;

            const asked = assistantAsked(msgs[j].content || '');
            const parts = splitParts(userText);

            // Multi-field replies (common when assistant asks 2 questions per turn in web chat).
            if (asked.city && asked.street && parts.length >= 2) {
              setIfGood('business_city', parts[0]);
              setIfGood('business_street', parts[1]);
              if (asked.house && parts.length >= 3) setIfGood('business_house_number', parts[2]);
              continue;
            }
            // If assistant asked for both city + street but user gave a single token,
            // only treat it as the city answer (do not guess street).
            if (asked.city && asked.street && parts.length < 2) {
              setIfGood('business_city', userText);
              continue;
            }

            if (asked.city) setIfGood('business_city', userText);
            if (asked.street) {
              // Allow combined answer like "היובלים 52"
              const cleaned = userText.replace(/^רחוב\s*/i, '').trim();
              const mm = cleaned.match(/^(.+?)\s+(\d+[A-Za-z\u0590-\u05FF]?)$/);
              if (mm) {
                setIfGood('business_street', mm[1]);
                setIfGood('business_house_number', mm[2]);
              } else {
                setIfGood('business_street', cleaned);
              }
            }
            if (asked.house) setIfGood('business_house_number', userText);
            if (asked.zip) setIfGood('business_zip', userText);
            if (asked.pobox) setIfGood('business_po_box', userText);
            if (asked.reg) {
              const d = digitsOnly(userText);
              if (d && d.length >= 8 && d.length <= 10) inferred.business_registration_id = d;
            }
          }

          const patch: Record<string, unknown> = {};
          for (const k of addressKeys) {
            const current = (userData as any)[k];
            if (isPollutedAddressValue(current)) {
              // Prefer inferred value, else clear.
              patch[k] = inferred[k] ?? '';
            }
          }

          // If reg id is missing, but we inferred it, persist it.
          if (!String((userData as any).business_registration_id ?? '').trim() && inferred.business_registration_id) {
            patch.business_registration_id = inferred.business_registration_id;
          }

          // Clear other (non-address) fields that look like a business registration ID.
          // We delete these keys directly (rather than setting empty string) because
          // setUserData intentionally skips empty strings for most keys.
          if (shouldRepairOther) {
            for (const k of otherKeys) {
              const current = String((userData as any)[k] ?? '').trim();
              if (!current) continue;
              const currentDigits = digitsOnly(current);
              const isPolluted = (regDigits && currentDigits && currentDigits === regDigits && looksLikeBusinessRegId(current))
                || (k === 'policy_start_date'
                  ? (looksLikeBusinessRegId(current) && !/^\d{4}-\d{2}-\d{2}$/.test(current))
                  : looksLikeBusinessRegId(current));
              if (!isPolluted) continue;
              try {
                await prisma.userData.deleteMany({
                  where: {
                    userId,
                    key: k,
                    ...(overlayFlowId ? { flowId: overlayFlowId } : {}),
                  } as any,
                });
              } catch {
                // best-effort
              }
            }
          }

          if (Object.keys(patch).length > 0) {
            await flowHelpers.setUserData(userId, overlayFlowId || activeUserFlow?.flow?.id || '', patch, conversation.id);
            userData = await flowHelpers.getUserData(userId, overlayFlowId);
          }

          // Refresh after deletions (if any) so UI doesn't show polluted fields.
          if (shouldRepairOther) {
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

    // Best-effort: per-field provenance derived from flow traces.
    // We prefer fieldsCollected (stage completion) and fall back to first-seen in userDataSnapshot.
    let fieldProvenance: Record<string, UiFieldProvenance> = {};
    try {
      const userMessages = (conversation.messages || [])
        .filter((m) => m.role === 'user')
        .map((m) => ({ createdAt: new Date(m.createdAt).getTime() }))
        .filter((m) => Number.isFinite(m.createdAt))
        .sort((a, b) => a.createdAt - b.createdAt);
      const lastUserMessageAtIso = userMessages.length > 0
        ? new Date(userMessages[userMessages.length - 1].createdAt).toISOString()
        : null;

      const traceRows = await prisma.flowTrace.findMany({
        where: { conversationId: conversation.id },
        orderBy: { enteredAt: 'asc' },
        select: {
          id: true,
          flowSlug: true,
          stageSlug: true,
          enteredAt: true,
          completedAt: true,
          fieldsCollected: true,
          userDataSnapshot: true,
        },
      });

      const out: Record<string, UiFieldProvenance> = {};
      const userCollectedKeys = new Set<string>();

      const isSystemDefaultKey = (key: string): boolean => {
        const k = String(key || '').trim();
        if (!k) return false;

        // Common computed/internal keys (not directly asked as user answers).
        if (/(^__|_code$|_source$|_confidence$|_reason$)/.test(k)) return true;

        // Segment resolution + derived identifiers are system-generated.
        if (k.startsWith('segment_')) return true;
        if (k === 'segment_id' || k === 'segment_group_id') return true;

        // Segment-derived default site type (commonly prefilled before asking).
        if (k === 'business_site_type') {
          const src = String((userData as any)?.segment_resolution_source || '').trim().toLowerCase();
          const segId = String((userData as any)?.segment_id || '').trim();
          const grpId = String((userData as any)?.segment_group_id || '').trim();
          // If we have a resolved segment already, treat business_site_type as system default unless user explicitly provided it later.
          if (src || segId || grpId) return true;
        }

        return false;
      };

      const classifyContributor = (key: string, inferredFromStage: UiFieldProvenance['contributor']): UiFieldProvenance['contributor'] => {
        if (isSystemDefaultKey(key)) return 'system';
        if (userCollectedKeys.has(key)) return 'user';
        return inferredFromStage;
      };

      const pickLastUserMessageTsWithin = (startMs: number, endMs: number): string | null => {
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
        // Find last user message in [startMs, endMs]
        let lo = 0;
        let hi = userMessages.length - 1;
        let lastIdx = -1;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          const t = userMessages[mid].createdAt;
          if (t < startMs) {
            lo = mid + 1;
          } else if (t > endMs) {
            hi = mid - 1;
          } else {
            lastIdx = mid;
            lo = mid + 1;
          }
        }
        if (lastIdx >= 0) return new Date(userMessages[lastIdx].createdAt).toISOString();
        return null;
      };

      for (const trace of traceRows) {
        const inferredContributor = contributorFromStageSlug(trace.stageSlug);
        const startMs = new Date(trace.enteredAt).getTime();
        const endMs = new Date(trace.completedAt || trace.enteredAt).getTime();
        // Prefer the last user message timestamp within the trace window for user-provided answers.
        const userAnswerTs = pickLastUserMessageTsWithin(startMs, endMs);
        const ts = (inferredContributor === 'user' ? userAnswerTs : null)
          || (trace.completedAt || trace.enteredAt)?.toISOString?.()
          || null;
        const fields = Array.isArray(trace.fieldsCollected) ? trace.fieldsCollected : [];
        for (const fieldSlug of fields) {
          const k = String(fieldSlug || '').trim();
          if (!k) continue;
          if (out[k]) continue;
          if (inferredContributor === 'user') userCollectedKeys.add(k);
          const contributor = classifyContributor(k, inferredContributor);
          out[k] = {
            ts,
            contributor,
            flowSlug: trace.flowSlug,
            stageSlug: trace.stageSlug,
            traceId: trace.id,
            method: 'fieldsCollected',
          };
        }
      }

      for (const trace of traceRows) {
        const snap = trace.userDataSnapshot as any;
        if (!snap || typeof snap !== 'object') continue;
        const inferredContributor = contributorFromStageSlug(trace.stageSlug);
        const startMs = new Date(trace.enteredAt).getTime();
        const endMs = new Date(trace.completedAt || trace.enteredAt).getTime();
        const userAnswerTs = pickLastUserMessageTsWithin(startMs, endMs);
        const ts = (inferredContributor === 'user' ? userAnswerTs : null)
          || trace.enteredAt?.toISOString?.()
          || null;
        for (const [kRaw, v] of Object.entries(snap)) {
          const k = String(kRaw || '').trim();
          if (!k) continue;
          if (out[k]) continue;
          if (!isPresentValue(v)) continue;
          const contributor = classifyContributor(k, inferredContributor);
          out[k] = {
            ts,
            contributor,
            flowSlug: trace.flowSlug,
            stageSlug: trace.stageSlug,
            traceId: trace.id,
            method: 'snapshot',
          };
        }
      }

      // Ensure we always have a provenance record for any key currently present in userData.
      // When traces are missing or a key never appears in snapshots/fieldsCollected, fall back to:
      // - contributor: treat as user if it is part of any UI-visible stage fieldsToCollect
      // - ts: conversation.updatedAt (best-effort)
      const userFieldKeys = new Set<string>();
      try {
        const flows: Array<UiFlow | null> = [activeFlow, ...completedFlows];
        flows.forEach((flow) => {
          flow?.stages?.forEach((s) => {
            const fields = Array.isArray((s as any).fieldsToCollect) ? (s as any).fieldsToCollect : [];
            fields.forEach((f: any) => {
              const k = String(f || '').trim();
              if (k) userFieldKeys.add(k);
            });
          });
        });
      } catch {
        // ignore
      }

      const fallbackSystemTs = conversation.updatedAt?.toISOString?.() || new Date().toISOString();
      const fallbackUserTs = lastUserMessageAtIso || fallbackSystemTs;
      Object.keys(userData || {}).forEach((kRaw) => {
        const k = String(kRaw || '').trim();
        if (!k) return;
        if (out[k]) return;
        const inferred = userFieldKeys.has(k) ? 'user' : 'system';
        const contributor = classifyContributor(k, inferred);
        out[k] = {
          ts: contributor === 'user' ? fallbackUserTs : fallbackSystemTs,
          contributor,
          method: 'snapshot',
        };
      });

      fieldProvenance = out;
    } catch {
      fieldProvenance = {};
    }

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
      fieldProvenance,
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
