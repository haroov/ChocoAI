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
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { first: null, last: null };

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

    if (he.length >= 2) {
      // Use last two Hebrew tokens as name (common: "<first> <last>")
      return { first: he[he.length - 2], last: he[he.length - 1] };
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

  if (tokens.length < 2 || tokens.length > 5) return { first: null, last: null };
  const first = tokens[0];
  const last = tokens.slice(1).join(' ').trim();
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

      if (!protectPair) {
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

  repairGroup('proposer_first_name', 'proposer_last_name');
  repairGroup('first_name', 'last_name');
  repairGroup('user_first_name', 'user_last_name');

  // Compatibility: if proposer_first_name contains a full name and proposer_last_name is missing/bad, split.
  try {
    const pf = String(out.proposer_first_name ?? '').replace(/\s+/g, ' ').trim();
    const pl = String(out.proposer_last_name ?? '').replace(/\s+/g, ' ').trim();
    if (pf && (!pl || isBadNameValue(pl)) && pf.split(' ').length >= 2) {
      const parts = pf.split(' ');
      out.proposer_first_name = parts[0];
      out.proposer_last_name = parts.slice(1).join(' ');
    }
  } catch {
    // best-effort
  }

  return out;
}
