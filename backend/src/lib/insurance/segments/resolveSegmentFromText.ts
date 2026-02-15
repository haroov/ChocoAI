import { z } from 'zod';
import { llmService } from '../../flowEngine/llmService';
import { getSegmentsCatalogProd } from './loadSegmentsCatalog';

export type ResolvedSegment = {
  segment_id?: string;
  segment_group_id?: string;
  segment_name_he?: string;
  group_name_he?: string;
  default_package_key?: string;
  source: 'catalog' | 'llm' | 'none';
  match_confidence: number;
};

function normalizeText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[״"'`’]/g, '')
    .replace(/[(){}\[\],.;:!?/\\\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  const n = normalizeText(s);
  if (!n) return [];
  return n
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    // Avoid numeric noise from phone numbers / ids in the first message.
    .filter((t) => !/^\d+$/.test(t));
}

function tokenizeInputWithAliases(rawInput: string): Set<string> {
  // Input tokens: remove very common "quote request" noise words that cause false positives
  // (e.g. matching "סוכן ביטוח" just because the user asked for ביטוח).
  const stop = new Set([
    // Pronouns / glue
    'אני',
    'אנחנו',
    'ביטוח',
    'מבוטח',
    'הצעה',
    'הצעת',
    'מחיר',
    'רוצה',
    'רציתי',
    'צריך',
    'צריכה',
    'אשמח',
    'אפשר',
    'תודה',
    'שלום',
    'היי',
    'הי',
    'נא',
    'לקבל',
    'עבור',
    'בשביל',
    'למען',
  ]);

  const base = tokenize(rawInput).filter((t) => !stop.has(t));
  const out = new Set<string>(base);

  const raw = String(rawInput || '');
  // Normalize punctuation to whitespace for abbreviation detection.
  // Important: JS word-boundaries (\b) don't behave well with Hebrew letters, so we rely on whitespace-ish boundaries.
  const rawWs = raw
    .replace(/[(){}\[\],.;:!?/\\\-–—_]/g, ' ')
    .replace(/\s+/g, ' ');

  // Common Hebrew abbreviations that otherwise become ambiguous tokens after normalization:
  // - רו"ח / רו״ח -> "רוח" (wind). We expand it to accounting-related tokens.
  // - עו"ד / עו״ד -> "עוד". We expand it to legal-related tokens.
  if (/(^|\s)רו[\"״'`’]?\s*ח(\s|$)/i.test(rawWs)) {
    ['רואה', 'חשבון', 'רואי', 'חשבונות', 'הנהלת'].forEach((t) => out.add(t));
  }
  if (/(^|\s)עו[\"״'`’]?\s*ד(\s|$)/i.test(rawWs)) {
    ['עורך', 'דין', 'עורכי'].forEach((t) => out.add(t));
  }

  // Insurance agent synonyms / inflections:
  // Users often say "סוכני ביטוח" (plural) or "סוכנות ביטוח" which won't match the singular segment label
  // due to token mismatch after normalization.
  if (/(\s|^)סוכנ(?:י|ים|ת|ות|ות)?\s+ביטוח(\s|$)/i.test(rawWs) || /(\s|^)סוכנות\s+ביטוח(\s|$)/i.test(rawWs)) {
    // Add the singular canonical token used in the catalog label ("סוכן ביטוח").
    out.add('סוכן');
    // Add "ביטוח" ONLY when explicitly in the phrase, to avoid generic insurance requests matching this segment.
    out.add('ביטוח');
  }

  // Hebrew prefix normalization for common prepositions (ל/ול) on *specific* safe nouns.
  // This fixes patterns like "למשרד", "להצעת", "לאדריכל".
  // We keep it conservative to avoid harming words where the first letter is part of the root.
  const safeNouns = new Set([
    // place types
    'משרד',
    'חנות',
    'קליניקה',
    'מסעדה',
    'מחסן',
    'מפעל',
    'סטודיו',
    'מרפאה',
    'סוכנות',
    // quote-request tokens that often appear with ל'
    'הצעה',
    'הצעת',
    'מחיר',
    'ביטוח',
  ]);

  // Profession roots (for stripping ל' on profession words)
  const professionRootRe = /^(אדריכ|מהנדס|הנדס|רואי|רואה|עורכ|סוכן|רופא|רוקח)/i;
  for (const t of [...out]) {
    const s = String(t || '').trim();
    if (!s) continue;
    const stripped = ((): string => {
      if (s.startsWith('ול') && s.length >= 4) return s.slice(2);
      if (s.startsWith('ל') && s.length >= 3) return s.slice(1);
      return '';
    })();
    if (!stripped) continue;
    // If the stripped token is a stopword (or a safe noun that is also stopword-like),
    // drop the original and don't keep it.
    if (stop.has(stripped)) {
      out.delete(s);
      continue;
    }

    // Replace only when it looks like a profession token or a safe noun.
    if (!(professionRootRe.test(stripped) || safeNouns.has(stripped))) continue;
    out.delete(s);
    out.add(stripped);
  }

  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const denom = Math.min(a.size, b.size);
  return denom ? inter / denom : 0;
}

function bestMatch<T>(items: T[], scoreFn: (it: T) => number): { item: T | null; score: number } {
  let best: T | null = null;
  let bestScore = -1;
  for (const it of items) {
    const s = scoreFn(it);
    if (s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return { item: best, score: Math.max(0, bestScore) };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function meaningfulTokenSet(tokens: Set<string>): Set<string> {
  // Remove extremely common Hebrew glue/business-type words that should not decide the segment.
  // This helps break ties like "חנות X" where many segments share "חנות" in their name/keywords.
  const generic = new Set([
    'אני',
    'אנחנו',
    'את',
    'אתה',
    'אתם',
    'הוא',
    'היא',
    'של',
    'עם',
    'על',
    'בעל',
    'בעלים',
    'בעלת',
    'בעלות',
    'עוסק',
    'עוסקת',
    // Business place-type tokens (too generic across many segments)
    'עסק',
    'חנות',
    'משרד',
    'קליניקה',
    'מסעדה',
    'מפעל',
    'מחסן',
    'סוכנות',
    // Politeness filler that may remain after stopword filtering
    'רבה',
  ]);

  const out = new Set<string>();
  for (const t of tokens) {
    const s = String(t || '').trim();
    if (!s) continue;
    if (generic.has(s)) continue;
    out.add(s);
  }
  return out;
}

function distinctTokenBonus(inputTokens: Set<string>, candidateTokens: Set<string>): number {
  const inputMeaningful = meaningfulTokenSet(inputTokens);
  const candMeaningful = meaningfulTokenSet(candidateTokens);
  if (inputMeaningful.size === 0 || candMeaningful.size === 0) return 0;

  let inter = 0;
  for (const t of inputMeaningful) if (candMeaningful.has(t)) inter++;
  // Small capped bonus per distinctive overlapping token.
  // This is a stable tie-breaker in cases where generic tokens yield identical overlap ratios.
  return Math.min(0.25, inter * 0.12);
}

function keywordPhraseBonus(params: {
  inputNorm: string;
  keywords: string[];
}): number {
  const input = String(params.inputNorm || '').trim();
  if (!input) return 0;
  const keywords = Array.isArray(params.keywords) ? params.keywords : [];
  if (keywords.length === 0) return 0;

  const generic = new Set([
    'עסק',
    'חנות',
    'משרד',
    'קליניקה',
    'מסעדה',
    'מחסן',
    'מפעל',
    'סוכנות',
    'ביטוח',
    'הצעה',
    'הצעת',
    'מחיר',
  ]);

  const normalizeKw = (s: string) => normalizeText(s);
  const hasMeaningful = (kwNorm: string) => {
    const toks = kwNorm.split(' ').map((t) => t.trim()).filter(Boolean);
    return toks.some((t) => t.length >= 2 && !generic.has(t));
  };

  for (const kw of keywords) {
    const kwNorm = normalizeKw(String(kw || '').trim());
    if (!kwNorm) continue;
    if (kwNorm.length < 4) continue; // too short to be decisive
    if (!hasMeaningful(kwNorm)) continue;
    if (input.includes(kwNorm)) {
      // Explicit keyword phrase match is a very strong signal.
      return 0.18;
    }
  }
  return 0;
}

function buildResolvedFromCatalog(params: {
  segment_id?: string;
  segment_group_id?: string;
  source: ResolvedSegment['source'];
  match_confidence: number;
}): ResolvedSegment {
  const catalog = getSegmentsCatalogProd();
  const found = params.segment_id ? catalog.segments.find((s) => s.segment_id === params.segment_id) : undefined;
  const groupId = params.segment_group_id || found?.segment_group_id;
  const group = groupId ? catalog.segment_groups.find((g) => g.group_id === groupId) : undefined;
  return {
    segment_id: found?.segment_id || params.segment_id,
    segment_group_id: groupId || undefined,
    segment_name_he: found?.segment_name_he,
    group_name_he: group?.group_name_he,
    default_package_key: found?.default_package_key || group?.default_package_key,
    source: params.source,
    match_confidence: clamp01(params.match_confidence),
  };
}

/**
 * Resolve segment/group from free text.
 *
 * Strategy:
 * 1) Deterministic catalog match (token overlap + substring hints)
 * 2) If low confidence and conversationId provided: LLM picks best segment group; then we refine segment within group deterministically.
 */
export async function resolveSegmentFromText(
  inputText: string,
  options?: { conversationId?: string },
): Promise<ResolvedSegment> {
  const text = String(inputText || '').trim();
  if (!text) return { source: 'none', match_confidence: 0 };

  const catalog = getSegmentsCatalogProd();
  const inputTokens = tokenizeInputWithAliases(text);
  const inputNorm = normalizeText(text);

  // --- (1) Deterministic match: segments ---
  const segMatch = bestMatch(catalog.segments, (s) => {
    const name = String(s.segment_name_he || '');
    const primary = String(s.business_profile_defaults?.primary_activity_he || '');
    const groupName = String(
      catalog.segment_groups.find((g) => g.group_id === s.segment_group_id)?.group_name_he || '',
    );
    const hay = [name, primary, groupName].filter(Boolean).join(' | ');
    const tokens = new Set(tokenize(hay));
    const jac = jaccard(inputTokens, tokens);
    // Strong signal: overlap with the *segment name itself* (not the whole haystack).
    // This is critical when the user's first message contains lots of extra tokens (name/phone/politeness),
    // which would otherwise dilute Jaccard similarity.
    const nameTokens = new Set(tokenize(name));
    const nameOverlap = overlapRatio(inputTokens, nameTokens);
    const kwArr = Array.isArray(s.keywords) ? s.keywords : [];
    const kwTokens = new Set(tokenize(kwArr.slice(0, 80).join(' ')));
    const kwOverlapRaw = overlapRatio(inputTokens, kwTokens);
    const kwOverlapMeaningful = overlapRatio(meaningfulTokenSet(inputTokens), meaningfulTokenSet(kwTokens));
    const kwOverlap = Math.max(kwOverlapRaw, kwOverlapMeaningful);
    const nameNorm = normalizeText(name);
    // Strong signal: exact match with a segment name.
    // Without this, short 2-token segments (e.g., "סוכן ביטוח") can be penalized by extra tokens
    // coming from groupName/primary_activity, preventing them from crossing the deterministic threshold.
    const exactName = Boolean(nameNorm && inputNorm === nameNorm);
    const bonus = exactName ? 0.6 : (nameNorm && inputNorm.includes(nameNorm) ? 0.25 : 0);
    const tieBreakBonus = distinctTokenBonus(inputTokens, nameTokens);
    const kwPhrase = keywordPhraseBonus({ inputNorm, keywords: kwArr.slice(0, 140) });
    return clamp01(Math.max(jac, nameOverlap * 0.95, kwOverlap * 0.97) + bonus + tieBreakBonus + kwPhrase);
  });

  if (segMatch.item && segMatch.score >= 0.55) {
    return buildResolvedFromCatalog({
      segment_id: segMatch.item.segment_id,
      segment_group_id: segMatch.item.segment_group_id,
      source: 'catalog',
      match_confidence: segMatch.score,
    });
  }

  // --- (1b) Deterministic match: groups (fallback) ---
  const grpMatch = bestMatch(catalog.segment_groups, (g) => {
    const name = String(g.group_name_he || '');
    const tokens = new Set(tokenize(name));
    const jac = jaccard(inputTokens, tokens);
    const nameNorm = normalizeText(name);
    const bonus = nameNorm && inputNorm.includes(nameNorm) ? 0.2 : 0;
    return clamp01(jac + bonus);
  });

  if (grpMatch.item && grpMatch.score >= 0.45) {
    const groupId = grpMatch.item.group_id;

    // Refine to a specific segment within the matched group (deterministic).
    // This is important for richer enrichment (segment_name_he/default_package_key).
    const segmentsInGroup = catalog.segments.filter((s) => s.segment_group_id === groupId);
    const segInGroup = bestMatch(segmentsInGroup, (s) => {
      const name = String(s.segment_name_he || '');
      const primary = String(s.business_profile_defaults?.primary_activity_he || '');
      const hay = [name, primary].filter(Boolean).join(' | ');
      const tokens = new Set(tokenize(hay));
      const jac = jaccard(inputTokens, tokens);
      const nameTokens = new Set(tokenize(name));
      const nameOverlap = overlapRatio(inputTokens, nameTokens);
      const kwArr = Array.isArray(s.keywords) ? s.keywords : [];
      const kwTokens = new Set(tokenize(kwArr.slice(0, 80).join(' ')));
      const kwOverlapRaw = overlapRatio(inputTokens, kwTokens);
      const kwOverlapMeaningful = overlapRatio(meaningfulTokenSet(inputTokens), meaningfulTokenSet(kwTokens));
      const kwOverlap = Math.max(kwOverlapRaw, kwOverlapMeaningful);
      const nameNorm = normalizeText(name);
      const bonus = nameNorm && inputNorm.includes(nameNorm) ? 0.25 : 0;
      const tieBreakBonus = distinctTokenBonus(inputTokens, nameTokens);
      const kwPhrase = keywordPhraseBonus({ inputNorm, keywords: kwArr.slice(0, 140) });
      return clamp01(Math.max(jac, nameOverlap * 0.95, kwOverlap * 0.97) + bonus + tieBreakBonus + kwPhrase);
    });

    const chosenSegmentId = segInGroup.item && segInGroup.score >= 0.28 ? segInGroup.item.segment_id : undefined;
    const confidence = Math.max(grpMatch.score, segInGroup.score * 0.9);

    return buildResolvedFromCatalog({
      segment_id: chosenSegmentId,
      segment_group_id: groupId,
      source: 'catalog',
      match_confidence: confidence,
    });
  }

  // --- (2) LLM-assisted group selection (if we have conversation context) ---
  const conversationId = String(options?.conversationId || '').trim();
  if (!conversationId) {
    // No LLM context allowed here; return best deterministic guess if any.
    if (segMatch.item && segMatch.score > 0) {
      return buildResolvedFromCatalog({
        segment_id: segMatch.item.segment_id,
        segment_group_id: segMatch.item.segment_group_id,
        source: 'catalog',
        match_confidence: segMatch.score,
      });
    }
    if (grpMatch.item && grpMatch.score > 0) {
      return buildResolvedFromCatalog({
        segment_group_id: grpMatch.item.group_id,
        source: 'catalog',
        match_confidence: grpMatch.score,
      });
    }
    return { source: 'none', match_confidence: 0 };
  }

  const groupList = catalog.segment_groups
    .slice(0, 120) // safety cap
    .map((g) => `${g.group_id}: ${String(g.group_name_he || '').trim()}`)
    .filter(Boolean)
    .join('\n');

  const zodSchema = z.object({
    segment_group_id: z.string().min(1).nullable(),
    match_confidence: z.number().min(0).max(1).nullable(),
  });

  const extracted = await llmService.extractFieldsData({
    conversationId,
    messageId: 'segment_resolve',
    message: text,
    flowId: 'segment_resolve',
    context: {
      fieldsDescription: {
        segment_group_id: `Choose ONE best group_id from this list:\n${groupList}`,
        match_confidence: 'Number between 0 and 1: how confident you are in the chosen group_id',
      },
      stageDescription: 'Resolve the best SMB segment group from a short business description.',
      zodSchema,
      stagePrompt: [
        'Output constraints:',
        '- segment_group_id MUST be a group_id from the list, or null if unsure.',
        '- Prefer returning null rather than guessing wildly.',
      ].join('\n'),
    },
  });

  const extractedParsed = zodSchema.safeParse(extracted);
  const llmGroupId = String((extractedParsed.success ? extractedParsed.data.segment_group_id : null) || '').trim();
  const llmConf = clamp01(Number(extractedParsed.success ? extractedParsed.data.match_confidence : 0));
  const group = llmGroupId ? catalog.segment_groups.find((g) => g.group_id === llmGroupId) : undefined;

  if (!group) {
    // Fall back to best deterministic segment/group guess
    if (segMatch.item && segMatch.score > 0) {
      return buildResolvedFromCatalog({
        segment_id: segMatch.item.segment_id,
        segment_group_id: segMatch.item.segment_group_id,
        source: 'catalog',
        match_confidence: segMatch.score,
      });
    }
    if (grpMatch.item && grpMatch.score > 0) {
      return buildResolvedFromCatalog({
        segment_group_id: grpMatch.item.group_id,
        source: 'catalog',
        match_confidence: grpMatch.score,
      });
    }
    return { source: 'none', match_confidence: 0 };
  }

  // Refine segment selection within group (deterministic)
  const segmentsInGroup = catalog.segments.filter((s) => s.segment_group_id === group.group_id);
  const segInGroup = bestMatch(segmentsInGroup, (s) => {
    const name = String(s.segment_name_he || '');
    const primary = String(s.business_profile_defaults?.primary_activity_he || '');
    const hay = [name, primary].filter(Boolean).join(' | ');
    const tokens = new Set(tokenize(hay));
    const jac = jaccard(inputTokens, tokens);
    const kwArr = Array.isArray(s.keywords) ? s.keywords : [];
    const kwTokens = new Set(tokenize(kwArr.slice(0, 80).join(' ')));
    const kwOverlap = overlapRatio(inputTokens, kwTokens);
    const nameNorm = normalizeText(name);
    const bonus = nameNorm && inputNorm.includes(nameNorm) ? 0.25 : 0;
    return clamp01(Math.max(jac, kwOverlap * 0.9) + bonus);
  });

  const chosenSegmentId = segInGroup.item && segInGroup.score >= 0.3 ? segInGroup.item.segment_id : undefined;
  const confidence = Math.max(llmConf, segInGroup.score * 0.85);

  return buildResolvedFromCatalog({
    segment_id: chosenSegmentId,
    segment_group_id: group.group_id,
    source: 'llm',
    match_confidence: confidence,
  });
}
