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
  seq?: number; // stable first-seen sequence for deterministic ordering
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
        // Auto-clean: if name fields were polluted by intent/segment text BEFORE we ever asked for a name,
        // clear them to prevent UX like "שלום ביטוח!".
        const assistantAskedForFirstOrLast = (conversation.messages || []).some((m) => {
          if (m.role !== 'assistant') return false;
          const t = String(m.content || '');
          return /מה\s+השם\s+הפרטי|שם\s*פרטי|מה\s+שם\s+(?:ה)?משפחה|שם\s*(?:ה)?משפחה/i.test(t);
        });
        const userExplicitlyProvidedName = (conversation.messages || []).some((m) => {
          if (m.role !== 'user') return false;
          const t = String(m.content || '').normalize('NFKC').trim();
          if (!t) return false;
          // explicit introduction patterns
          if (/(?:^|[\s,.;:!?()'"“”׳״-])(?:שמי|קוראים\s+לי)(?:[\s:–—-]+)[\u0590-\u05FF]{2,}/.test(t)) return true;
          // short name-like messages (1-3 Hebrew tokens, no insurance intent words)
          const hasIntent = /(הצעת\s*ביטוח|ביטוח|הצעה|פוליסה|רוצה|מבקש|צריך|מחפש|מעוניין|אשמח)/.test(t);
          if (!hasIntent && t.length <= 40) {
            const tokens = t
              .replace(/[“”"׳״']/g, ' ')
              .trim()
              .split(/\s+/)
              .map((x) => x.trim())
              .filter(Boolean);
            const he = tokens.filter((x) => /^[\u0590-\u05FF]{2,}$/.test(x));
            if (tokens.length === he.length && he.length >= 1 && he.length <= 3) return true;
          }
          return false;
        });

        const first0 = String((userData as any).user_first_name || (userData as any).first_name || '').trim();
        const last0 = String((userData as any).user_last_name || (userData as any).last_name || '').trim();
        const looksPolluted = Boolean(first0 && last0) && (
          /ביטוח|הצעה|פוליסה/i.test(first0)
          || /^ל[\u0590-\u05FF]{2,}$/.test(first0) // Hebrew preposition prefix (likely "למשרד", "לאדריכל", etc.)
          || /^ל[\u0590-\u05FF]{2,}$/.test(last0)
        );

        if (!assistantAskedForFirstOrLast && !userExplicitlyProvidedName && looksPolluted && overlayFlowId) {
          await prisma.userData.deleteMany({
            where: {
              userId,
              flowId: overlayFlowId,
              key: {
                in: [
                  'first_name',
                  'last_name',
                  'user_first_name',
                  'user_last_name',
                  'proposer_first_name',
                  'proposer_last_name',
                ],
              },
            },
          });
          // Refresh local snapshot for response
          userData = await flowHelpers.getUserData(userId, overlayFlowId);
        }

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
          // Best-effort: infer name ONLY from explicit self-introduction patterns.
          // Do NOT guess names from generic intent/segment sentences (e.g., "רוצה ביטוח לאדריכל"),
          // since Hebrew prepositions/occupations often look like "two tokens" and cause corruption.
          const inferExplicitNamePair = (hay: string): { first: string; last: string } | null => {
            const s = String(hay || '').replace(/\s+/g, ' ').trim();
            if (!s) return null;
            // "שמי <first> <last>" / "קוראים לי <first> <last>"
            const mm = s.match(/(?:שמי|קוראים\s+לי)\s+([\u0590-\u05FF]{2,})\s+([\u0590-\u05FF]{2,})(?=\s*(?:[,\n|]|$))/);
            if (!mm) return null;
            const first = String(mm[1] || '').trim();
            const last = String(mm[2] || '').trim();
            if (!first || !last) return null;
            // Never infer referral tokens as names.
            if (referralTokens.has(first.toLowerCase()) || referralTokens.has(last.toLowerCase())) return null;
            return { first, last };
          };
          const inferred = inferExplicitNamePair(joined);
          const inferredFirst = inferred ? inferred.first : '';
          const inferredLast = inferred ? inferred.last : '';
          // IMPORTANT:
          // This endpoint runs for UI rendering and must NEVER corrupt canonical name fields.
          // Only repair first_name if it is clearly garbage (needsRepair=true).
          //
          // For missing last name, be conservative: only set last_name when inferredFirst matches the existing first name.
          // (In Israel, multi-word first/last names are common; do not guess/swap here.)
          const canFillMissingLastConservatively = missingLastName && inferredFirst && inferredLast && inferredFirst === first;

          if (needsRepair && inferredFirst && inferredFirst !== first) {
            await flowHelpers.setUserData(userId, overlayFlowId || activeUserFlow?.flow?.id || '', {
              first_name: inferredFirst,
              ...(inferredLast ? { last_name: inferredLast } : {}),
            }, conversation.id);
            // Refresh local snapshot for response
            userData = await flowHelpers.getUserData(userId, overlayFlowId);
          } else if (canFillMissingLastConservatively) {
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
      const msgsChrono = (conversation.messages || [])
        .map((m) => ({
          role: String((m as any).role || ''),
          createdAt: new Date((m as any).createdAt).getTime(),
          text: String((m as any).content || ''),
        }))
        .filter((m) => Number.isFinite(m.createdAt))
        .sort((a, b) => a.createdAt - b.createdAt);

      const userMessages = (conversation.messages || [])
        .filter((m) => m.role === 'user')
        .map((m) => ({
          createdAt: new Date(m.createdAt).getTime(),
          text: String(m.content || ''),
        }))
        .filter((m) => Number.isFinite(m.createdAt))
        .sort((a, b) => a.createdAt - b.createdAt);
      const firstUserMessageAtIso = userMessages.length > 0
        ? new Date(userMessages[0].createdAt).toISOString()
        : null;
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
      let seqCounter = 0;

      // Union of UI-visible "asked" keys (user stages only).
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

      const isSystemDefaultKey = (key: string): boolean => {
        const k = String(key || '').trim();
        if (!k) return false;

        // Common computed/internal keys (not directly asked as user answers).
        if (/(^__|_code$|_source$|_confidence$|_reason$)/.test(k)) return true;
        if (k.startsWith('client_')) return true;
        if (/google|geo|place|registry|formattedaddress|plus_code/i.test(k)) return true;
        if (k.startsWith('default_')) return true;

        // If company registry enrichment happened, legal-* business fields are system-derived.
        const hasRegistry = !!String((userData as any)?.business_registry_source || '').trim()
          || !!String((userData as any)?.business_legal_entity_type_source || '').trim();
        if (hasRegistry && (k.startsWith('business_legal_') || k === 'business_legal_entity_type')) return true;

        // Segment resolution + derived identifiers are system-generated.
        if (k.startsWith('segment_')) return true;
        if (k === 'segment_id' || k === 'segment_group_id') return true;

        return false;
      };

      const systemOverrideTsForKey = (key: string): string | null => {
        const k = String(key || '').trim();
        if (!k) return null;
        // Client/browser telemetry should be attributed to the start of the conversation (not the last update).
        if (k.startsWith('client_')) return conversation.createdAt?.toISOString?.() || null;

        // Israel Companies Registry enrichment keys should be anchored to the time we collected the company number,
        // otherwise they drift to the end of "Collected Data" even though they conceptually belong with the reg number.
        // We anchor them to the first user message that contains the business registration ID / company number digits.
        if (k === 'il_companies_registry_red_flags' || k.startsWith('il_companies_registry_')) {
          try {
            const anchor = (userData as any)?.business_registration_id
              || (userData as any)?.il_company_number
              || (userData as any)?.entity_tax_id;
            const digits = String(anchor ?? '').replace(/\D/g, '');
            if (digits && digits.length >= 7) {
              const needle = digits.slice(-7);
              for (const m of userMessages) {
                const msgDigits = String(m.text || '').replace(/\D/g, '');
                if (msgDigits.includes(needle)) return new Date(m.createdAt).toISOString();
              }
            }
          } catch {
            // best-effort
          }
        }

        return null;
      };

      const classifyContributor = (
        key: string,
        inferredFromStage: UiFieldProvenance['contributor'],
        ctx?: { userAnswerTs?: string | null; overrideUserTs?: string | null },
      ): UiFieldProvenance['contributor'] => {
        // Segment-derived defaults should be system unless we have direct evidence the user provided them.
        if (key === 'business_site_type') {
          const src = String((userData as any)?.segment_resolution_source || '').trim().toLowerCase();
          const segId = String((userData as any)?.segment_id || '').trim();
          const grpId = String((userData as any)?.segment_group_id || '').trim();
          const hasSegmentResolution = !!(src || segId || grpId);
          if (hasSegmentResolution && !ctx?.overrideUserTs) return 'system';
        }
        if (isSystemDefaultKey(key)) return 'system';
        if (ctx?.overrideUserTs) return 'user';
        // If we have evidence of a user answer in this trace window, and this key is part of the asked fields,
        // treat it as user-provided (even if processed through OpenAI).
        if (ctx?.userAnswerTs && (userFieldKeys.has(key) || inferredFromStage === 'user')) return 'user';
        // Otherwise, consider it system-derived (API/default/computed).
        return 'system';
      };

      const digitsOnly = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

      const normalizeForMatch = (s: string): string => s
        .toLowerCase()
        .replace(/[“”"׳״']/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}\s@.+-]/gu, '') // keep letters/numbers/basic email chars
        .trim();

      const findUserMessageTsForValue = (
        value: unknown,
        mode: 'exact' | 'digits',
        opts?: { wholeWord?: boolean },
      ): string | null => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        if (mode === 'digits') {
          const d = digitsOnly(raw);
          if (!d || d.length < 7) return null;
          // Find first message that contains at least last 7 digits (robust to formatting).
          const needle = d.slice(-7);
          for (const m of userMessages) {
            const msgDigits = digitsOnly(m.text);
            if (msgDigits.includes(needle)) return new Date(m.createdAt).toISOString();
          }
          return null;
        }
        // exact substring match (case-insensitive)
        const needle = normalizeForMatch(raw);
        for (const m of userMessages) {
          const msg = normalizeForMatch(m.text);
          if (!opts?.wholeWord) {
            if (msg.includes(needle)) return new Date(m.createdAt).toISOString();
          } else {
            // Whole-word match in normalized space-separated text.
            const re = new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?=$|\\s)`, 'i');
            if (re.test(msg)) return new Date(m.createdAt).toISOString();
          }
        }
        return null;
      };

      const findUserMessageTsForKeyValue = (key: string, value: unknown): string | null => {
        const k = String(key || '').trim().toLowerCase();
        if (!k) return null;
        if (value === null || value === undefined) return null;

        const findReplyAfterAsk = (
          askRe: RegExp,
          replyPred: (replyText: string) => boolean,
        ): string | null => {
          for (let i = 0; i < msgsChrono.length; i += 1) {
            const msg = msgsChrono[i];
            if (msg.role !== 'assistant') continue;
            if (!askRe.test(String(msg.text || ''))) continue;
            for (let j = i + 1; j < msgsChrono.length; j += 1) {
              const next = msgsChrono[j];
              if (next.role !== 'user') continue;
              const reply = String(next.text || '').trim();
              if (!reply) continue;
              if (replyPred(reply)) return new Date(next.createdAt).toISOString();
              // Stop at first user reply after ask (avoid matching later unrelated answers)
              break;
            }
          }
          return null;
        };

        // New customer status: user may answer "לקוחה חדשה"/"לקוח קיים"/etc.
        // The stored value is often boolean/normalized label, so we need semantic matching.
        if (k === 'is_new_customer') {
          const raw = String(value ?? '').trim().toLowerCase();
          const asBool = value === true || raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y' || raw === 'new' || raw.includes('חדש');
          const newRe = /(לקוח(?:ה)?\s*חדש(?:ה)?|לקוחה\s*חדשה|לקוח\s*חדש|new\s*customer|i['’]?m\s+new)/i;
          const existingRe = /(לקוח(?:ה)?\s*(?:קיים(?:ה)?|ותיק(?:ה)?)|לקוחה\s*קיימת|לקוח\s*קיים|existing\s*customer|i['’]?m\s+an?\s+existing)/i;
          for (const m of userMessages) {
            const text = String(m.text || '');
            if (asBool) {
              if (newRe.test(text)) return new Date(m.createdAt).toISOString();
            } else {
              if (existingRe.test(text)) return new Date(m.createdAt).toISOString();
            }
          }

          // Fallback: user answered "כן/לא" after the assistant asked about new/existing customer.
          const askRe = /(האם|אתה|את)\s*(?:לקוח(?:ה)?\s*(?:חדש(?:ה)?|קיים(?:ה)?|ותיק(?:ה)?))|new\s*customer|existing\s*customer/i;
          const yesRe = /^(?:כן|כן\.|כן!|yes|y|true|1|חדש(?:ה)?)$/i;
          const noRe = /^(?:לא|לא\.|לא!|no|n|false|0|קיים(?:ה)?|ותיק(?:ה)?)$/i;
          for (let i = 0; i < msgsChrono.length; i += 1) {
            const msg = msgsChrono[i];
            if (msg.role !== 'assistant') continue;
            if (!askRe.test(msg.text || '')) continue;
            // Find the next user message after this assistant prompt.
            for (let j = i + 1; j < msgsChrono.length; j += 1) {
              const next = msgsChrono[j];
              if (next.role !== 'user') continue;
              const reply = String(next.text || '').trim();
              if (!reply) continue;
              const normalized = normalizeForMatch(reply);
              const token = normalized.split(/\s+/g)[0] || normalized;
              if (asBool) {
                if (yesRe.test(token) || /כן|yes|true|חדש/.test(normalized)) return new Date(next.createdAt).toISOString();
              } else {
                if (noRe.test(token) || /לא|no|false|קיים|ותיק/.test(normalized)) return new Date(next.createdAt).toISOString();
              }
              break;
            }
          }
          return null;
        }

        // City: user may answer after an explicit question ("באיזה יישוב/עיר...")
        if (k === 'business_city') {
          const s = String(value ?? '').trim();
          if (s.length >= 2 && s.length <= 80) {
            // Prefer direct value match in user message
            const direct = findUserMessageTsForValue(s, 'exact', { wholeWord: true });
            if (direct) return direct;
          }
          const askRe = /(יישוב|עיר|באיזה\s*(?:יישוב|עיר))/i;
          return findReplyAfterAsk(askRe, (reply) => {
            const normalizedReply = normalizeForMatch(reply);
            const normalizedVal = normalizeForMatch(String(value ?? ''));
            if (!normalizedVal) return false;
            return normalizedReply.includes(normalizedVal) || normalizedVal.includes(normalizedReply);
          });
        }

        // PO box: user may answer "אין/לא" (stored value may be empty string).
        if (k === 'business_po_box') {
          const askRe = /(ת\.?\s*ד|תיבת\s*דואר|תא\s*דואר|po\s*box)/i;
          return findReplyAfterAsk(askRe, (reply) => (
            /^(אין|לא|אין\.|לא\.|none|no)$/i.test(normalizeForMatch(reply))
            || /אין\s*ת\.?\s*ד|אין\s*תיבת\s*דואר/i.test(reply)
          ));
        }

        // Additional locations count: user may answer "אין/לא" meaning 0.
        if (k === 'business_additional_locations_count') {
          const n = Number(value);
          const askRe = /(כתובות\s*נוספות|מיקומים\s*נוספים|סניפים\s*נוספים|additional\s*(?:locations|addresses))/i;
          if (Number.isFinite(n) && n === 0) {
            return findReplyAfterAsk(askRe, (reply) => (
              /^(אין|לא|none|no)$/i.test(normalizeForMatch(reply))
              || /אין\s+(?:כתובות|מיקומים|סניפים)\s+נוספ/i.test(reply)
            ));
          }
          // If user actually gave a number in text, try to match it.
          const direct = findUserMessageTsForValue(String(value ?? ''), 'exact');
          if (direct) return direct;
          return null;
        }

        // Name keys: if the extracted name appears in a user message, treat as user input.
        if (/(^|_)(first_name|last_name)($|_)/.test(k)) {
          const s = String(value ?? '').trim();
          // Guardrails: avoid matching single letters / very long strings.
          if (s.length >= 2 && s.length <= 40) {
            return findUserMessageTsForValue(s, 'exact', { wholeWord: true });
          }
        }

        // Email keys: match exact email substring.
        if (k.includes('email')) {
          const s = String(value ?? '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s)) return null;
          return findUserMessageTsForValue(s, 'exact');
        }

        // Phone keys: match digits.
        if (k.includes('phone') || k.includes('mobile')) {
          return findUserMessageTsForValue(value, 'digits');
        }

        // Generic asked string fields: if the exact value appears in a user message, treat as user.
        // This captures cases like business_site_type="חנות פרחים" which the user provided.
        if (userFieldKeys.has(String(key || '').trim())) {
          if (typeof value === 'string') {
            const s = String(value).trim();
            if (s.length >= 2 && s.length <= 120) {
              return findUserMessageTsForValue(s, 'exact');
            }
          }
        }

        return null;
      };

      const pickLastUserMessageTsWithin = (startMs: number, endMs: number): string | null => {
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
        // Find first user message in [startMs, endMs] (stable: doesn't drift as more answers arrive in same stage window).
        for (const m of userMessages) {
          if (m.createdAt >= startMs && m.createdAt <= endMs) return new Date(m.createdAt).toISOString();
        }
        return null;
      };

      for (const trace of traceRows) {
        const inferredContributor = contributorFromStageSlug(trace.stageSlug);
        const startMs = new Date(trace.enteredAt).getTime();
        const endMs = new Date(trace.completedAt || trace.enteredAt).getTime();
        // Prefer the FIRST user message timestamp within the trace window for user-provided answers.
        const userAnswerTs = pickLastUserMessageTsWithin(startMs, endMs);
        const ts = (inferredContributor === 'user' ? userAnswerTs : null)
          || (trace.completedAt || trace.enteredAt)?.toISOString?.()
          || null;
        const fields = Array.isArray(trace.fieldsCollected) ? trace.fieldsCollected : [];
        for (const fieldSlug of fields) {
          const k = String(fieldSlug || '').trim();
          if (!k) continue;
          if (out[k]) continue;
          const overrideUserTs = !isSystemDefaultKey(k)
            ? findUserMessageTsForKeyValue(k, (userData as any)?.[k])
            : null;
          const contributor = classifyContributor(k, inferredContributor, { userAnswerTs, overrideUserTs });
          if (contributor === 'user') userCollectedKeys.add(k);
          const overrideSystemTs = (contributor === 'system') ? systemOverrideTsForKey(k) : null;
          out[k] = {
            ts: overrideUserTs || overrideSystemTs || ts,
            contributor,
            flowSlug: trace.flowSlug,
            stageSlug: trace.stageSlug,
            traceId: trace.id,
            method: 'fieldsCollected',
            seq: seqCounter++,
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
        for (const kRaw of Object.keys(snap).sort((a, b) => String(a).localeCompare(String(b)))) {
          const k = String(kRaw || '').trim();
          if (!k) continue;
          if (out[k]) continue;
          const v = (snap as any)[kRaw];
          if (!isPresentValue(v)) continue;
          const overrideUserTs = !isSystemDefaultKey(k)
            ? (findUserMessageTsForKeyValue(k, (userData as any)?.[k]) || findUserMessageTsForKeyValue(k, v))
            : null;
          const contributor = classifyContributor(k, inferredContributor, { userAnswerTs, overrideUserTs });
          if (contributor === 'user') userCollectedKeys.add(k);
          const overrideSystemTs = (contributor === 'system') ? systemOverrideTsForKey(k) : null;
          out[k] = {
            ts: overrideUserTs || overrideSystemTs || ts,
            contributor,
            flowSlug: trace.flowSlug,
            stageSlug: trace.stageSlug,
            traceId: trace.id,
            method: 'snapshot',
            seq: seqCounter++,
          };
        }
      }

      // Ensure we always have a provenance record for any key currently present in userData.
      const fallbackSystemTs = conversation.updatedAt?.toISOString?.() || new Date().toISOString();
      // Stable fallback for user-provided fields when we cannot match the value:
      // prefer first user message (conversation start), else conversation createdAt, else updatedAt.
      const fallbackUserTs = firstUserMessageAtIso
        || conversation.createdAt?.toISOString?.()
        || fallbackSystemTs;
      Object.keys(userData || {}).sort((a, b) => String(a).localeCompare(String(b))).forEach((kRaw) => {
        const k = String(kRaw || '').trim();
        if (!k) return;
        if (out[k]) return;
        const inferred = userFieldKeys.has(k) ? 'user' : 'system';
        const overrideUserTs = !isSystemDefaultKey(k)
          ? findUserMessageTsForKeyValue(k, (userData as any)?.[k])
          : null;
        const contributor = classifyContributor(k, inferred, { userAnswerTs: inferred === 'user' ? fallbackUserTs : null, overrideUserTs });
        const overrideSystemTs = (contributor === 'system') ? systemOverrideTsForKey(k) : null;
        out[k] = {
          ts: contributor === 'user'
            ? (overrideUserTs || fallbackUserTs)
            : (overrideSystemTs || fallbackSystemTs),
          contributor,
          method: 'snapshot',
          seq: seqCounter++,
        };
      });

      // Recompute stable sequence ordering by timestamp (best-effort).
      // This ensures "Collected Data" is ordered by when values were first observed,
      // rather than alphabetical fallbacks, and prevents system enrichment keys from drifting to the end.
      try {
        const parseTs = (ts: unknown): number => {
          const t = String(ts || '').trim();
          if (!t) return Number.POSITIVE_INFINITY;
          const ms = Date.parse(t);
          return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
        };
        const entries = Object.entries(out);
        entries.sort((a, b) => {
          const ta = parseTs(a[1]?.ts);
          const tb = parseTs(b[1]?.ts);
          if (ta !== tb) return ta - tb;
          const sa = typeof a[1]?.seq === 'number' ? a[1]!.seq! : Number.POSITIVE_INFINITY;
          const sb = typeof b[1]?.seq === 'number' ? b[1]!.seq! : Number.POSITIVE_INFINITY;
          if (sa !== sb) return sa - sb;
          return String(a[0]).localeCompare(String(b[0]));
        });
        entries.forEach(([k, prov], idx) => {
          out[k] = { ...prov, seq: idx };
        });
      } catch {
        // best-effort
      }

      fieldProvenance = out;
    } catch {
      fieldProvenance = {};
    }

    // Hide internal enrichment/meta keys from "Collected Data" UI, while keeping them in API Log.
    // NOTE: We only filter the API response payload. The underlying persisted userData remains intact
    // for internal/debug use and flow logic.
    try {
      const hideFromCollectedData = new Set<string>([
        'business_legal_entity_type_source',
        'business_registry_source',
        'business_legal_name',
        'il_company_number',
        'il_companies_registry_name_match_should_verify',
        // Potentially present if we ever persist registrar code fields (should stay API-log-only)
        'il_companies_registry_city_code',
        'il_companies_registry_classification_code',
        'il_companies_registry_country_code',
        'il_companies_registry_limitation_code',
        'il_companies_registry_purpose_code',
        'il_companies_registry_status_code',
        'il_companies_registry_violator_code',
      ]);
      for (const k of hideFromCollectedData) {
        if (k in (userData as any)) delete (userData as any)[k];
      }
    } catch {
      // best-effort
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
