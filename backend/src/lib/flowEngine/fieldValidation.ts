import { logger } from '../../utils/logger';
import { FieldDefinition } from './types';
import validator from 'validator';
import HEBREW_PROHIBITED_WORDS_V1 from './prohibitedWords/hebrew_prohibited_words_v1.json';

export type FieldValidationResult = {
  ok: boolean;
  normalizedValue: unknown;
  reason?: string;
  suggestion?: string;
};

export type LegalEntityInference = {
  /** Must match the flow enum (Hebrew label) */
  heLabel: string;
  /** Internal detail code */
  code: string;
  /** Optional more specific detail for reporting/debugging */
  detailHe?: string;
};

const PROHIBITED_WORD_LISTS: Record<string, string[]> = {
  hebrew_prohibited_words_v1: Array.isArray(HEBREW_PROHIBITED_WORDS_V1)
    ? (HEBREW_PROHIBITED_WORDS_V1 as unknown as string[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : [],
};

const PROHIBITED_WORD_LISTS_NORMALIZED: Record<string, string[]> = {};

function normalizeForProhibitedSubstringMatch(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // Remove common quote-like characters (Hebrew + English) to prevent bypass via punctuation.
    .replace(/[“”"׳״'’`´]/g, '')
    // Remove separators and punctuation to prevent bypass via spacing/dashes.
    .replace(/[\s\-\u05BE\u2010-\u2015_.:,;!?()\[\]{}\\/]+/g, '')
    .trim();
}

function getNormalizedProhibitedList(listIdRaw: string): string[] {
  const listId = String(listIdRaw ?? '').trim();
  if (!listId) return [];
  if (PROHIBITED_WORD_LISTS_NORMALIZED[listId]) return PROHIBITED_WORD_LISTS_NORMALIZED[listId];
  const src = PROHIBITED_WORD_LISTS[listId] || [];
  const normalized = Array.from(new Set(
    src
      .map((w) => normalizeForProhibitedSubstringMatch(w))
      .filter(Boolean),
  ));
  PROHIBITED_WORD_LISTS_NORMALIZED[listId] = normalized;
  return normalized;
}

function safeCompileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch (err) {
    logger.warn('[fieldValidation] Invalid regex pattern; skipping pattern validation', {
      pattern,
      error: String((err as any)?.message || err),
    });
    return null;
  }
}

export function isPresentNonPlaceholder(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return false;
    const lowered = s.toLowerCase();
    if (lowered === 'null' || lowered === ':null' || lowered === 'undefined' || lowered === ':undefined') return false;
    return true;
  }
  if (Array.isArray(v)) return v.length > 0;
  // boolean false is a valid answer
  return true;
}

export function normalizeIsraeliMobile(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;

  // Accept missing leading zero: 5XXXXXXXX
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;

  // Accept local: 05XXXXXXXX
  if (/^05\d{8}$/.test(digits)) return digits;

  // Accept +972 / 972 prefix: 9725XXXXXXXX -> 05XXXXXXXX
  if (/^9725\d{8}$/.test(digits)) return `0${digits.slice(3)}`;

  // Sometimes users paste 97205XXXXXXXX (extra 0)
  if (/^97205\d{8}$/.test(digits)) return `0${digits.slice(4)}`;

  return null;
}

function normalizeIsraeliIdDigits(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 9) return null;
  return digits.padStart(9, '0');
}

export function isValidIsraeliIdChecksum(id9: string): boolean {
  if (!/^\d{9}$/.test(id9)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const n = Number(id9[i]) * (i % 2 === 0 ? 1 : 2);
    sum += n > 9 ? (Math.floor(n / 10) + (n % 10)) : n;
  }
  return sum % 10 === 0;
}

export function inferBusinessLegalEntityTypeFromBusinessRegistrationId(regId: string): LegalEntityInference {
  const digits = String(regId || '').replace(/\D/g, '');
  const id9 = digits.length <= 9 ? digits.padStart(9, '0') : digits;

  // Companies / entities: 50-59 (Israeli Companies Registrar patterns)
  if (/^5\d{8}$/.test(id9)) {
    if (id9.startsWith('50')) {
      // Not in enum – map to closest allowed and keep detail in code.
      return { heLabel: 'חברה פרטית', code: 'government_company', detailHe: 'חברה ממשלתית' };
    }
    if (id9.startsWith('51')) return { heLabel: 'חברה פרטית', code: 'private_company' };
    if (id9.startsWith('52')) return { heLabel: 'חברה ציבורית', code: 'public_company' };
    if (id9.startsWith('53') || id9.startsWith('54') || id9.startsWith('55')) {
      return { heLabel: 'שותפות', code: 'partnership' };
    }
    if (id9.startsWith('56')) {
      return { heLabel: 'חברה פרטית', code: 'foreign_company', detailHe: 'חברה זרה' };
    }
    if (id9.startsWith('57')) {
      return { heLabel: 'אגודה', code: 'cooperative_association', detailHe: 'אגודה שיתופית' };
    }
    if (id9.startsWith('58')) {
      return { heLabel: 'עמותה', code: 'nonprofit', detailHe: 'עמותה / מלכ״ר' };
    }
    if (id9.startsWith('59')) {
      return { heLabel: 'עמותה', code: 'endowment', detailHe: 'הקדש' };
    }
  }

  // Default for non-5xxxxxxx identifiers: sole proprietor (typically AM).
  // We can’t reliably distinguish AM vs exempt/small without turnover info.
  return { heLabel: 'עוסק מורשה', code: 'authorized_dealer_default' };
}

function looksLikeEmailField(fieldSlug: string, field: FieldDefinition): boolean {
  const slug = String(fieldSlug || '').toLowerCase();
  if (slug === 'email' || slug.endsWith('_email') || slug.includes('email')) return true;
  const desc = String(field.description || '');
  return /דואר\s*אלקטרוני|אימייל|מייל|\bemail\b/i.test(desc);
}

function looksLikeIsraeliMobileField(fieldSlug: string, field: FieldDefinition): boolean {
  const slug = String(fieldSlug || '').toLowerCase();
  if (slug === 'mobile_phone' || slug === 'user_mobile_phone' || slug === 'user_phone' || slug === 'proposer_mobile_phone') return true;
  const desc = String(field.description || '');
  return /טלפון\s*נייד|נייד|\bmobile\b/i.test(desc);
}

function looksLikeIsraeliIdField(fieldSlug: string, field: FieldDefinition): boolean {
  const slug = String(fieldSlug || '').toLowerCase();
  if (slug === 'user_id' || slug === 'legal_id' || slug === 'id_number' || slug === 'tz') return true;
  if (/(^|_)(id|tz|teudat|zehut)(_|$)/i.test(slug)) return true;
  const desc = String(field.description || '');
  return /ת[\"״׳']?ז|תעודת\s*זהות|מספר\s*זהות/i.test(desc);
}

function looksLikeBusinessRegistrationIdField(fieldSlug: string, field: FieldDefinition): boolean {
  const slug = String(fieldSlug || '').toLowerCase();
  // Common keys across flows
  if (slug === 'business_registration_id' || slug === 'regnum') return true;
  const desc = String(field.description || '');
  // Hebrew: ח"פ / ע"מ / מספר רישום
  // NOTE: Do NOT treat entity_tax_id as IL by slug alone (it may hold US EIN).
  if (slug === 'entity_tax_id') {
    return /ח[\"״׳']?פ|ע[\"״׳']?מ|מספר\s*רישום/i.test(desc);
  }
  return /ח[\"״׳']?פ|ע[\"״׳']?מ|מספר\s*רישום|vat|company\s*id/i.test(desc);
}

function isValidEmailValue(email: string): boolean {
  const s = String(email || '').trim();
  if (!s) return false;
  // Use a mature validator; no DNS/MX checks.
  return validator.isEmail(s, {
    allow_utf8_local_part: false,
    ignore_max_length: true,
    allow_ip_domain: false,
  });
}

function splitEmail(emailRaw: string): { local: string; domain: string } | null {
  const s = String(emailRaw || '').trim();
  const at = s.lastIndexOf('@');
  if (at <= 0 || at >= s.length - 1) return null;
  return { local: s.slice(0, at), domain: s.slice(at + 1) };
}

function normalizeEmailForStorage(emailRaw: string): string {
  const parts = splitEmail(emailRaw);
  if (!parts) return String(emailRaw || '').trim();
  // Preserve local-part case; normalize domain to lowercase.
  return `${parts.local}@${parts.domain.toLowerCase()}`.trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1, // deletion
        dp[j - 1] + 1, // insertion
        prev + cost, // substitution
      );
      prev = tmp;
    }
  }
  return dp[n];
}

export function suggestEmailCorrection(emailRaw: string): string | null {
  const parts = splitEmail(emailRaw);
  if (!parts) return null;
  const local = parts.local.trim();
  const domainRaw = parts.domain.trim().toLowerCase();
  if (!local || !domainRaw) return null;

  // Fix obvious TLD typos
  const tldTypos: Array<[RegExp, string]> = [
    [/\.con$/i, '.com'],
    [/\.cmo$/i, '.com'],
    [/\.comm$/i, '.com'],
    [/\.cm$/i, '.com'],
    [/\.coom$/i, '.com'],
  ];
  for (const [re, replacement] of tldTypos) {
    if (re.test(domainRaw)) {
      const suggested = `${local}@${domainRaw.replace(re, replacement)}`;
      return suggested !== emailRaw.trim() ? suggested : null;
    }
  }

  // Provider domain typos (no DNS; best-effort)
  const commonDomains = [
    'gmail.com',
    'googlemail.com',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'icloud.com',
    'yahoo.com',
    'yahoo.co.il',
    // Israel common ISPs
    'walla.co.il',
    'bezeqint.net',
    'bezeqint.co.il',
    '012.net.il',
    '013.net',
    'netvision.net.il',
  ];
  const domain = domainRaw.replace(/\.+$/g, '');
  if (!domain) return null;
  let best: { d: string; dist: number } | null = null;
  for (const d of commonDomains) {
    const dist = levenshtein(domain, d);
    if (dist === 0) return null;
    if (dist <= 2 && (!best || dist < best.dist)) best = { d, dist };
  }
  if (best) {
    return `${local}@${best.d}`;
  }

  return null;
}

export function validateEmailValue(emailRaw: string): { ok: boolean; normalized: string; suggestion?: string; reason?: string } {
  const normalized = normalizeEmailForStorage(emailRaw);
  if (!isValidEmailValue(normalized)) {
    const suggestion = suggestEmailCorrection(emailRaw) || undefined;
    return { ok: false, normalized, suggestion, reason: 'email_invalid' };
  }
  const suggestion = suggestEmailCorrection(emailRaw) || undefined;
  if (suggestion) {
    return { ok: false, normalized, suggestion, reason: 'email_typo_suspected' };
  }
  return { ok: true, normalized };
}

export function validateFieldValue(fieldSlug: string, field: FieldDefinition | undefined, value: unknown): FieldValidationResult {
  // If we don't have a field definition, don't block collection.
  if (!field) return { ok: true, normalizedValue: value };

  // Missing values are handled by presence checks elsewhere.
  if (!isPresentNonPlaceholder(value)) return { ok: true, normalizedValue: value };

  // Only enforce validation rules for string fields (to avoid breaking flows due to historical type inconsistencies).
  if (field.type !== 'string') return { ok: true, normalizedValue: value };

  let s = String(value).trim();
  if (!s) return { ok: true, normalizedValue: value };

  // business_zip: accept 5 or 7 digits (Israel), must not start with 0.
  // Also allow "לא ידוע" (user can explicitly say it's unknown).
  if (String(fieldSlug || '').toLowerCase() === 'business_zip') {
    const token = s
      .trim()
      .toLowerCase()
      .replace(/[“”"׳״']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const isUnknown = token === 'לא ידוע'
      || token === 'לא יודע'
      || token === 'לא יודעת'
      || token === 'unknown'
      || token === 'dont know'
      || token === 'don\'t know';
    if (isUnknown) return { ok: true, normalizedValue: 'לא ידוע' };

    const digits = s.replace(/\D/g, '');
    // Treat "0" / "00000" / "0000000" as "unknown"
    if (digits && /^0+$/.test(digits)) return { ok: true, normalizedValue: 'לא ידוע' };
    const lenOk = digits.length === 5 || digits.length === 7;
    const startsOk = digits.length > 0 && digits[0] !== '0';
    if (lenOk && startsOk) return { ok: true, normalizedValue: digits };
    return {
      ok: false,
      normalizedValue: value,
      reason: 'zip_invalid',
      suggestion: 'נא להזין מיקוד בן 5 או 7 ספרות (לא מתחיל ב-0), או לכתוב "לא ידוע".',
    };
  }

  // business_po_box: allow a clear "no PO box" answer and short numeric PO box values.
  // We store:
  // - false (boolean) when user says "אין/לא/ללא" etc.
  // - digits (string) when numeric and <= 7 digits.
  if (String(fieldSlug || '').toLowerCase() === 'business_po_box') {
    // Preserve explicit boolean false if already provided by deterministic extraction.
    if (value === false) return { ok: true, normalizedValue: false };

    // Normalize common punctuation/noise so answers like "אין.", "לא!", "אין לי", etc. are accepted.
    const token = s
      .trim()
      .toLowerCase()
      .replace(/[“”"׳״']/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—.,;:!?()\[\]{}]+/g, '')
      .replace(/[\s\-–—.,;:!?()\[\]{}]+$/g, '')
      .trim();
    // NOTE:
    // Do NOT use `\b` word-boundary here: Hebrew letters are not `\w` in JS regex, so `\b` fails.
    const looksLikeNo = token === 'אין'
      || token === 'לא'
      || token === 'ללא'
      || token.startsWith('אין ')
      || token.startsWith('אין לי')
      || token.startsWith('אין לנו')
      || token === 'none'
      || token === 'no';
    if (looksLikeNo) return { ok: true, normalizedValue: false };

    const digits = s.replace(/\D/g, '');
    if (digits && digits.length <= 7) return { ok: true, normalizedValue: digits };

    return {
      ok: false,
      normalizedValue: value,
      reason: 'po_box_invalid',
      suggestion: 'אם יש ת.ד — נא להזין את המספר (עד 7 ספרות). אם אין — לכתוב "אין".',
    };
  }

  // Field-specific normalizations (to accept common short answers while keeping enums strict).
  // business_legal_entity_type: users often reply with abbreviations like ע״מ / ח״פ / ח״צ.
  if (String(fieldSlug || '').toLowerCase() === 'business_legal_entity_type') {
    const token = s
      .trim()
      .replace(/[“”"׳״']/g, '')
      .replace(/[\s/\\\-.–—.,;:!?()\[\]{}]+/g, '')
      .toLowerCase();

    // Company suffix (Ltd.) in Hebrew: בע"מ / חברה בע"מ -> "חברה פרטית" in this flow schema.
    // Note: this is distinct from ע"מ (authorized dealer), which normalizes to "עמ" after quote removal.
    if (token === 'בעמ' || token.endsWith('בעמ') || token.includes('חברהבעמ')) s = 'חברה פרטית';

    // Hebrew abbreviation aliases
    if (token === 'עמ') s = 'עוסק מורשה';
    if (token === 'חפ') s = 'חברה פרטית';
    if (token === 'חצ') s = 'חברה ציבורית';

    // Hebrew short answers
    if (token === 'פרטית') s = 'חברה פרטית';
    if (token === 'ציבורית') s = 'חברה ציבורית';

    // Hebrew phrase variants (remove spaces already)
    if (token.includes('עוסקומורשה')) s = 'עוסק מורשה';
    if (token.includes('עוסקפטור')) s = 'עוסק פטור';
    if (token.includes('עוסקזעיר')) s = 'עוסק זעיר';
    if (token.includes('חברהפרטית')) s = 'חברה פרטית';
    if (token.includes('חברהציבורית')) s = 'חברה ציבורית';
    if (token.includes('שותפות')) s = 'שותפות';
    if (token.includes('עמותה')) s = 'עמותה';
    if (token.includes('אגודה')) s = 'אגודה';

    // English-ish fallbacks
    if (token.includes('authorizeddealer') || token.includes('vat')) s = 'עוסק מורשה';
    if (token.includes('exempt')) s = 'עוסק פטור';
    if (token.includes('partnership')) s = 'שותפות';
    if (token.includes('private')) s = 'חברה פרטית';
    if (token.includes('public')) s = 'חברה ציבורית';
    if (token.includes('ngo') || token.includes('nonprofit')) s = 'עמותה';
    if (token.includes('association') || token.includes('cooperative')) s = 'אגודה';
  }

  // Special-case validations (requested):
  if (looksLikeEmailField(fieldSlug, field)) {
    const vr = validateEmailValue(s);
    if (!vr.ok) return { ok: false, normalizedValue: value, reason: vr.reason || 'email_invalid', suggestion: vr.suggestion };
    s = vr.normalized;
  }

  if (looksLikeIsraeliMobileField(fieldSlug, field)) {
    const normalized = normalizeIsraeliMobile(s);
    if (!normalized) return { ok: false, normalizedValue: value, reason: 'mobile_invalid' };
    s = normalized;
  }

  if (looksLikeIsraeliIdField(fieldSlug, field)) {
    const id9 = normalizeIsraeliIdDigits(s);
    if (!id9) return { ok: false, normalizedValue: value, reason: 'israeli_id_invalid' };
    if (!isValidIsraeliIdChecksum(id9)) return { ok: false, normalizedValue: value, reason: 'israeli_id_invalid' };
    s = id9;
  }

  // Israel business identifiers (ח"פ / ע"מ): same checksum mechanism as Israeli ID.
  // We accept 8-9 digits (pads leading zeros to 9) and validate checksum.
  if (looksLikeBusinessRegistrationIdField(fieldSlug, field)) {
    const id9 = normalizeIsraeliIdDigits(s);
    if (!id9) return { ok: false, normalizedValue: value, reason: 'business_registration_id_invalid' };
    if (!isValidIsraeliIdChecksum(id9)) return { ok: false, normalizedValue: value, reason: 'business_registration_id_invalid' };
    s = id9;
  }

  // Prohibited words (flow-defined; deterministic). Matching mode: substring (strict).
  try {
    const listId = String(field.prohibitedWordsList || '').trim();
    if (listId) {
      const hay = normalizeForProhibitedSubstringMatch(s);
      if (hay) {
        const prohibited = getNormalizedProhibitedList(listId);
        for (const bad of prohibited) {
          if (bad && hay.includes(bad)) return { ok: false, normalizedValue: value, reason: 'prohibited_word' };
        }
      }
    }
  } catch {
    // best-effort
  }

  // Generic constraints
  if (typeof field.minLength === 'number' && Number.isFinite(field.minLength)) {
    if (s.length < field.minLength) return { ok: false, normalizedValue: value, reason: 'minLength' };
  }
  if (typeof field.maxLength === 'number' && Number.isFinite(field.maxLength)) {
    if (s.length > field.maxLength) return { ok: false, normalizedValue: value, reason: 'maxLength' };
  }

  if (Array.isArray(field.enum) && field.enum.length > 0) {
    if (!field.enum.includes(s)) return { ok: false, normalizedValue: value, reason: 'enum' };
  }

  if (typeof field.pattern === 'string' && field.pattern.trim()) {
    const re = safeCompileRegex(field.pattern.trim());
    if (re && !re.test(s)) return { ok: false, normalizedValue: value, reason: 'pattern' };
  }

  return { ok: true, normalizedValue: s };
}

export function getFieldDisplayNameHe(fieldSlug: string, field?: FieldDefinition): string {
  const slug = String(fieldSlug || '').toLowerCase();
  const desc = String(field?.description || '');

  // Names (critical for invalid-value retry UX + deterministic extraction)
  if (slug === 'first_name' || slug === 'user_first_name' || slug === 'proposer_first_name') return 'השם הפרטי';
  if (slug === 'last_name' || slug === 'user_last_name' || slug === 'proposer_last_name') return 'שם המשפחה';

  if (/(^|_)(email|mail)(_|$)/i.test(slug) || /אימייל|דואר\s*אלקטרוני|מייל/i.test(desc)) return 'האימייל';
  if (/(^|_)(mobile|phone)(_|$)/i.test(slug) || /טלפון\s*נייד|נייד/i.test(desc)) return 'מספר הנייד';
  if (slug === 'business_registration_id' || slug === 'regnum'
    || (slug === 'entity_tax_id' && /ח[\"״׳']?פ|ע[\"״׳']?מ|מספר\s*רישום/i.test(desc))
    || /ח[\"״׳']?פ|ע[\"״׳']?מ|מספר\s*רישום/i.test(desc)) return 'מספר ח״פ/ע״מ';
  if (/(^|_)(id|tz|zehut)(_|$)/i.test(slug) || /ת[\"״׳']?ז|תעודת\s*זהות|מספר\s*זהות/i.test(desc)) return 'מספר תעודת הזהות';

  // Business address (Flow 02 and others)
  if (slug === 'business_city' || /יישוב|עיר/.test(desc)) return 'העיר';
  if (slug === 'business_street' || /רחוב/.test(desc)) return 'הרחוב';
  if (slug === 'business_house_number' || /מס['\"״׳']?\s*בית|מספר\s*בית/.test(desc)) return 'מספר הבית';
  if (slug === 'business_zip' || /מיקוד/.test(desc)) return 'המיקוד';
  if (slug === 'business_po_box' || /ת\\.?[\"״׳']?ד|תיבת\\s*דואר|תא\\s*דואר/.test(desc)) return 'ת״ד';
  if (slug === 'business_full_address' || /כתובת\s*מלאה/.test(desc)) return 'הכתובת המלאה';

  // Flow 02 gate question (carrier phrasing)
  if (slug === 'business_interruption_type' || /אובדן\s*הכנסה|הפסקת\s*פעילות/.test(desc)) return 'כיסוי לאובדן הכנסה';

  return 'הערך';
}
