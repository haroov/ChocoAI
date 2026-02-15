export type InsuredRelationToBusinessHe = 'בעלים' | 'מנהל' | 'מורשה חתימה';

/**
 * Best-effort deterministic inference of insured_relation_to_business from Hebrew text.
 *
 * Goal: capture explicit role phrasing like:
 * - "אני בעלים של ..."
 * - "בעלת משרד ..."
 * - "אני מנהלת ..."
 * - "מורשה חתימה ..."
 *
 * Guardrails:
 * - Avoid false positives like "לבעלים" (not the user's role).
 * - Prefer first-person / role-at-start phrasing.
 */
export function inferInsuredRelationToBusinessHe(textRaw: string): InsuredRelationToBusinessHe | null {
  const raw = String(textRaw || '').trim();
  if (!raw) return null;

  const s = raw
    .replace(/[“”"׳״']/g, '')
    .replace(/[.,;:!?()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  // Strong explicit phrase anywhere (safe enough).
  if (/(^| )מורשה חתימה( |$)/.test(s)) return 'מורשה חתימה';

  // Tokenize and inspect the leading clause.
  const toks = s.split(' ').filter(Boolean);
  if (toks.length === 0) return null;

  const stripLeadingHebrewPrefixes = (t: string): string => {
    // Strip definite article ה- only (avoid removing meaningful prefixes like ל-/ב- that can change meaning).
    return t.startsWith('ה') && t.length >= 3 ? t.slice(1) : t;
  };

  const isLikelyFirstPersonLead = (t: string): boolean => {
    const x = stripLeadingHebrewPrefixes(t);
    return x === 'אני' || x === 'אנחנו' || x === 'הנני';
  };

  const normalizeRoleTok = (t: string): string => stripLeadingHebrewPrefixes(t);

  // We accept role at the start, optionally preceded by "אני/אנחנו/הנני".
  let i = 0;
  if (isLikelyFirstPersonLead(toks[0])) i = 1;

  const roleTok = toks[i] ? normalizeRoleTok(toks[i]) : '';
  if (!roleTok) return null;

  // Guardrail: reject common false-positive forms like "לבעלים" / "בבעלים" etc.
  // (prefix letters attached to the token)
  if (/^[לבכמוש]בעלים$/.test(roleTok)) return null;

  if (roleTok === 'בעלים' || roleTok === 'בעלת') return 'בעלים';
  if (roleTok === 'מנהל' || roleTok === 'מנהלת') return 'מנהל';

  // Also accept role as first token "מורשה" + "חתימה"
  if (roleTok === 'מורשה' && toks[i + 1] === 'חתימה') return 'מורשה חתימה';

  return null;
}

