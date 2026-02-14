type NamePair = { first: string | null; last: string | null };

const HEBREW_TOKEN_RE = /^[\u0590-\u05FF]{2,}$/;

const DEFAULT_STOPWORDS = new Set<string>([
  // greetings
  'הי', 'היי', 'שלום', 'אהלן', 'הלו',
  // common fillers
  'אני', 'צריך', 'רוצה', 'מבקש', 'הצעת', 'הצעה', 'ביטוח', 'לעסק', 'לעסקי',
  // business terms
  'משרד', 'עורך', 'עורכי', 'דין', 'עו״ד', 'עו"ד',
  // contact labels
  'נייד', 'טלפון', 'מספר', 'פלאפון', 'אימייל', 'מייל', 'דוא״ל', 'דואל', 'אמייל',
  // customer status tokens
  'לקוח', 'חדש', 'קיים', 'ותיק',
]);

const NON_NAME_TOKENS = new Set<string>([
  // insurance / intent nouns
  'ביטוח', 'הצעה', 'הצעת', 'פוליסה',
  // segment nouns (common)
  'אדריכל', 'אדריכלים', 'הנדסאי', 'הנדסאים',
  'רואה', 'חשבון', 'חשבונאות', 'מתווך', 'תיווך', 'סוכן', 'ביטוח',
  // business site nouns (often appear in intent prompts)
  'משרד', 'חנות', 'מסעדה', 'קליניקה', 'סטודיו', 'מחסן', 'מרלוג',
  // common first names that appear near phones; keep these OUT of NON_NAME_TOKENS
]);

export function isBadNameValue(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!s) return false;
  const lowered = s.toLowerCase();

  // greetings
  if (['הי', 'היי', 'שלום', 'אהלן', 'הלו', 'hi', 'hello', 'hey'].includes(lowered)) return true;

  // contact labels / common non-names
  if ([
    'נייד', 'טלפון', 'מספר', 'מספר טלפון', 'פלאפון', 'נייד:',
    'אימייל', 'מייל', 'דוא״ל', 'דואל', 'אמייל', 'email', 'e-mail', 'mail', 'phone',
  ].includes(lowered)) return true;

  // digits / @ can't be part of a name token
  if (/\d/.test(s) || /@/.test(s)) return true;

  return false;
}

function heToken(t: string): boolean {
  return HEBREW_TOKEN_RE.test(t);
}

function normalizeChunk(s: string): string {
  return String(s || '')
    .replace(/[“”"׳״']/g, '')
    .replace(/^(שמי|שם|קוראים לי|אני)\s*[:\-–—]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort Hebrew name extraction from a free-text contact block.
 *
 * Examples it should handle:
 * - "ליאב גפן\nנייד\n050...\nמייל\n..." -> {first:"ליאב", last:"גפן"}
 * - "שמי ליאב גפן" -> {first:"ליאב", last:"גפן"}
 */
export function inferFirstLastFromText(text: string): NamePair {
  const raw = String(text || '').trim();
  if (!raw) return { first: null, last: null };
  const rawFlat = raw.replace(/\s+/g, ' ').trim();

  // Guardrail: do not infer names from generic intent/insurance messages.
  // Example: "אני רוצה ביטוח לאדריכל" should not yield first="ביטוח" last="לאדריכל".
  // Only infer in such cases if the user explicitly introduced themselves or provided contact signals.
  const hasExplicitIntro = /(?:^|[\s,.;:!?()'"“”׳״-])(?:שמי|קוראים\s+לי)(?:[\s:–—-]+)[\u0590-\u05FF]{2,}/.test(rawFlat);
  const hasContactSignal = /@|\d{7,}|\b(phone|email)\b/i.test(rawFlat) || /\b(נייד|טלפון|אימייל|מייל|דוא״ל|דואל)\b/.test(rawFlat);
  const hasIntentKeywords = /(הצעת\s*ביטוח|ביטוח|הצעה|פוליסה|רוצה|מבקש|צריך|מחפש|מעוניין)/.test(rawFlat);
  if (hasIntentKeywords && !hasExplicitIntro && !hasContactSignal) return { first: null, last: null };

  // If a message contains a phone/email contact signal, users often include their name either:
  // - as a dedicated name line (e.g. "ליאב גפן") in a contact block, OR
  // - right before the phone number on the same line (e.g. "יעל 050-...") — in which case we should
  //   extract a first-name chunk only (1-2 words) and not guess last name from unrelated text.
  try {
    if (hasContactSignal) {
      const lines = raw
        .split(/\r?\n/)
        .map((l) => String(l || '').trim())
        .filter(Boolean);

      const parseHebrewTokens = (line: string): string[] => line
        .replace(/[“”"׳״'’`´]/g, ' ')
        .replace(/[.,;:!?()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => heToken(t))
        .filter((t) => !DEFAULT_STOPWORDS.has(t))
        .filter((t) => !NON_NAME_TOKENS.has(t))
        // Drop Hebrew preposition prefixes (e.g. "למשרד", "לאדריכל") which are not names.
        .filter((t) => !/^ל[\u0590-\u05FF]{2,}$/.test(t));

      // Prefer a dedicated name line without digits/@ (high confidence).
      for (const line of lines) {
        if (/[@\d]/.test(line)) continue;
        const toks = parseHebrewTokens(line);
        if (toks.length === 2) return { first: toks[0], last: toks[1] };
      }

      // Fallback: name chunk right before phone/email on the same line.
      for (const line of lines) {
        if (!/[@\d]/.test(line)) continue;
        const m = /^(.*?)(@|\d{7,})/.exec(line);
        const before = String(m?.[1] || '').trim();
        if (!before) continue;
        const toks = parseHebrewTokens(before).slice(-2);
        if (toks.length >= 1) return { first: toks.join(' '), last: null };
      }
    }
  } catch {
    // best-effort
  }

  // Cut at common separators/labels (phone/email) so we keep just the name portion.
  const cutKeywords = /(,|\n|(?:\bנייד\b)|(?:\bטלפון\b)|(?:\bאימייל\b)|(?:\bמייל\b)|(?:\bemail\b)|(?:\bphone\b)|@|\d)/i;
  const idx = raw.search(cutKeywords);
  const head = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  if (!head) return { first: null, last: null };

  // Explicit labeled patterns (more reliable than token heuristics)
  // e.g., "שם משפחה גפן שם פרטי ליאב"
  const labeled = head.match(/שם\s*משפחה\s*[:\-–—]?\s*([\u0590-\u05FF]{2,})\s+שם\s*פרטי\s*[:\-–—]?\s*([\u0590-\u05FF]{2,})/);
  if (labeled) {
    const last = String(labeled[1] || '').trim();
    const first = String(labeled[2] || '').trim();
    if (first && last) return { first, last };
  }

  const chunks = head
    .split(/[,;\n]+/)
    .map((c) => normalizeChunk(c))
    .filter(Boolean);

  const parseChunk = (chunk: string): NamePair => {
    const tokens = chunk
      .split(/\s+/)
      .map((t) => t.replace(/[.,;:!?()[\]{}]/g, '').trim())
      .filter(Boolean);

    const he = tokens
      .filter((t) => heToken(t))
      .filter((t) => !DEFAULT_STOPWORDS.has(t));

    if (he.length === 2) {
      // High confidence only: exactly 2 Hebrew tokens.
      return { first: he[0], last: he[1] };
    }
    if (he.length === 1) return { first: he[0], last: null };
    return { first: null, last: null };
  };

  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    const parsed = parseChunk(chunks[i]);
    if (parsed.first) return parsed;
  }

  // Regex fallback: "שמי <first> <last>" embedded in a longer sentence
  const m = head.match(/(?:שמי|קוראים לי)\s+([\u0590-\u05FF]{2,})\s+([\u0590-\u05FF]{2,})/);
  if (m) {
    const first = String(m[1] || '').trim();
    const last = String(m[2] || '').trim();
    if (first && last) return { first, last };
  }

  // Final fallback: use the first 2-5 tokens of the head (legacy behavior)
  const cleaned = normalizeChunk(head);
  if (!cleaned) return { first: null, last: null };

  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:!?()[\]{}]/g, '').trim())
    .filter(Boolean)
    .filter((t) => !/^(נייד|טלפון|אימייל|מייל)$/i.test(t));

  // Policy: only return a pair when there are EXACTLY 2 tokens.
  if (tokens.length !== 2) return { first: null, last: null };
  const first = tokens[0];
  const last = tokens[1];
  if (!first || !last) return { first: null, last: null };
  return { first, last };
}

function pickNonEmpty(...vals: unknown[]): unknown {
  return vals.find((v) => v !== null && v !== undefined && String(v).trim() !== '');
}

function hasExplicitGoodValue(augmented: Record<string, unknown>, key: string): boolean {
  // If the caller explicitly provided a non-empty, non-garbage value in this update.
  if (!(key in augmented)) return false;
  const v = augmented[key];
  const s = String(v ?? '').trim();
  if (!s) return false;
  return !isBadNameValue(s);
}

export function repairNameFieldsFromInference(options: {
  current: Record<string, unknown>;
  augmented: Record<string, unknown>;
  inferred: NamePair;
}): Record<string, unknown> {
  const { current, augmented, inferred } = options;
  const out: Record<string, unknown> = { ...augmented };

  const inferFirst = inferred.first ? String(inferred.first).trim() : '';
  const inferLast = inferred.last ? String(inferred.last).trim() : '';
  const hasPair = Boolean(inferFirst && inferLast);

  // If the caller explicitly set a multi-word name in the canonical keys (first_name/last_name),
  // do NOT infer/repair other alias groups (user_/proposer_) in this turn.
  // Otherwise, we can accidentally overwrite the explicit value via alias writes later in setUserData().
  const explicitMainFirst = hasExplicitGoodValue(augmented, 'first_name') ? String(augmented.first_name ?? '').trim() : '';
  const explicitMainLast = hasExplicitGoodValue(augmented, 'last_name') ? String(augmented.last_name ?? '').trim() : '';
  const existingMainFirst = String(pickNonEmpty(augmented.first_name, current.first_name) ?? '').trim();
  const existingMainLast = String(pickNonEmpty(augmented.last_name, current.last_name) ?? '').trim();
  const mainLastMissingOrBad = !existingMainLast || isBadNameValue(existingMainLast);
  const mainFirstMissingOrBad = !existingMainFirst || isBadNameValue(existingMainFirst);
  const skipAliasGroupsDueToMultiwordCanonical = (
    (explicitMainFirst && explicitMainFirst.includes(' ') && mainLastMissingOrBad)
    || (explicitMainLast && explicitMainLast.includes(' ') && mainFirstMissingOrBad)
  );

  const repairGroup = (firstKey: string, lastKey: string) => {
    const existingFirst = String(pickNonEmpty(augmented[firstKey], current[firstKey]) ?? '').trim();
    const existingLast = String(pickNonEmpty(augmented[lastKey], current[lastKey]) ?? '').trim();

    const firstMissingOrBad = !existingFirst || isBadNameValue(existingFirst);
    const lastMissingOrBad = !existingLast || isBadNameValue(existingLast);
    const swapDetected = Boolean(existingFirst && existingLast && inferFirst && inferLast)
      && existingFirst === inferLast
      && existingLast === inferFirst;

    if (hasPair && (firstMissingOrBad || lastMissingOrBad || swapDetected)) {
      // Key fix:
      // - If *either* side is missing/bad (e.g. last="נייד") we repair BOTH together.
      // - If swap is detected, repair BOTH together.
      //
      // IMPORTANT: we do this even if one side "looks good" in the current update,
      // because a contact-block paste often causes first/last shifts (e.g. first="גפן", last="נייד").
      const explicitFirstGood = hasExplicitGoodValue(augmented, firstKey);
      const explicitLastGood = hasExplicitGoodValue(augmented, lastKey);
      const protectPair = explicitFirstGood && explicitLastGood && !swapDetected && !firstMissingOrBad && !lastMissingOrBad;

      // IMPORTANT:
      // In Israel it's common for first/last names to contain 2+ words (e.g., "ניצן אריאלה", "שפרלינג גפן").
      // If the caller explicitly provided a multi-word name in this update, do NOT auto-split it into first+last
      // just because inference found a pair in the same string.
      const explicitFirst = explicitFirstGood ? String(augmented[firstKey] ?? '').trim() : '';
      const explicitLast = explicitLastGood ? String(augmented[lastKey] ?? '').trim() : '';
      const explicitFirstHasSpace = explicitFirst.includes(' ');
      const explicitLastHasSpace = explicitLast.includes(' ');

      if (!protectPair) {
        // Case A: Explicit multi-word first name (no explicit last) → keep as-is, don't infer last.
        if (explicitFirstGood && !explicitLastGood && explicitFirstHasSpace && lastMissingOrBad && !swapDetected) return;
        // Case B: Explicit multi-word last name (no explicit first) → keep as-is, don't infer first.
        if (explicitLastGood && !explicitFirstGood && explicitLastHasSpace && firstMissingOrBad && !swapDetected) return;

        // Case C: Explicit single-token first name (no explicit last) → only fill last if it matches inference.
        if (explicitFirstGood && !explicitLastGood && lastMissingOrBad && !swapDetected) {
          // If the explicit first token is actually the inferred last, treat it as misplacement and repair both.
          if (explicitFirst && explicitFirst === inferLast) {
            out[firstKey] = inferFirst;
            out[lastKey] = inferLast;
            return;
          }
          // If explicit first matches inferred first, fill missing last but do not overwrite first.
          if (explicitFirst && explicitFirst === inferFirst) {
            out[lastKey] = inferLast;
            return;
          }
          // Otherwise, don't guess (avoid false positives).
          return;
        }

        // Case D: Explicit single-token last name (no explicit first) → only fill first if it matches inference.
        if (explicitLastGood && !explicitFirstGood && firstMissingOrBad && !swapDetected) {
          if (explicitLast && explicitLast === inferFirst) {
            out[firstKey] = inferFirst;
            out[lastKey] = inferLast;
            return;
          }
          if (explicitLast && explicitLast === inferLast) {
            out[firstKey] = inferFirst;
            return;
          }
          return;
        }

        // Default behavior: no explicit good single-side input, or swap detected → repair both.
        out[firstKey] = inferFirst;
        out[lastKey] = inferLast;
      }
      return;
    }

    // Partial inference: fill only missing/bad slots.
    if (inferred.first && firstMissingOrBad && !hasExplicitGoodValue(augmented, firstKey)) {
      out[firstKey] = inferred.first;
    }
    if (inferred.last && lastMissingOrBad && !hasExplicitGoodValue(augmented, lastKey)) {
      out[lastKey] = inferred.last;
    }
  };

  repairGroup('first_name', 'last_name');
  if (!skipAliasGroupsDueToMultiwordCanonical) {
    repairGroup('proposer_first_name', 'proposer_last_name');
    repairGroup('user_first_name', 'user_last_name');
  }

  // Compatibility: if proposer_first_name contains a full name and proposer_last_name is missing/bad, split.
  try {
    if (skipAliasGroupsDueToMultiwordCanonical) return out;
    const pf = String(out.proposer_first_name ?? '').replace(/\s+/g, ' ').trim();
    const pl = String(out.proposer_last_name ?? '').replace(/\s+/g, ' ').trim();
    // Only split when it's EXACTLY 2 tokens; multi-word first names are common.
    if (pf && (!pl || isBadNameValue(pl)) && pf.split(' ').length === 2) {
      const parts = pf.split(' ');
      out.proposer_first_name = parts[0];
      out.proposer_last_name = parts.slice(1).join(' ');
    }
  } catch {
    // best-effort
  }

  return out;
}
