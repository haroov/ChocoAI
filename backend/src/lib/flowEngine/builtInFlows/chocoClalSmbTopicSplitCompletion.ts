type ProcessMeta = {
  process_key?: string;
  title_he?: string;
  ask_if?: string | null;
  audience?: 'customer' | 'internal' | string;
};

type RawQuestion = {
  field_key_en?: string | null;
  required_mode?: 'required' | 'optional' | 'conditional' | string;
  required_if?: string | null;
  ask_if?: string | null;
  audience?: 'customer' | 'internal' | string;
  input_type?: string | null;
};

type RawProcessFileLike = {
  process?: ProcessMeta;
  questions?: RawQuestion[];
};

function replaceLooseEquality(input: string): string {
  // Replace single '=' with '===', but do not touch >=, <=, !=, ==, ===.
  const s = String(input || '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '=') {
      out += ch;
      continue;
    }
    const prev = i > 0 ? s[i - 1] : '';
    const next = i + 1 < s.length ? s[i + 1] : '';
    const isPartOfTwoCharOp = (prev === '>' || prev === '<' || prev === '!' || prev === '=');
    const isAlreadyEq = next === '=';
    if (isPartOfTwoCharOp || isAlreadyEq) {
      out += ch;
      continue;
    }
    out += '===';
  }
  return out;
}

function prefixIdentifiersWithUserData(expr: string): string {
  const reserved = new Set<string>([
    'true', 'false', 'null', 'undefined',
    'NaN', 'Infinity',
    // operators / words we emit
    '&&', '||',
    // helper functions
    '__includes', '__present',
    // globals
    'Math', 'Number', 'String', 'Array', 'Object',
  ]);

  let out = '';
  let inSingleQuote = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '\'') {
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }

    if (inSingleQuote) {
      out += ch;
      continue;
    }

    // Identifier start
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      const word = expr.slice(i, j);
      if (reserved.has(word)) {
        out += word;
      } else {
        out += `userData.${word}`;
      }
      i = j - 1;
      continue;
    }

    out += ch;
  }

  return out;
}

function rewriteBooleanEqualityComparisons(compiledJs: string): string {
  // Motivation:
  // In production we sometimes see boolean-like fields stored as strings (e.g., "true"/"false", "כן"/"לא", "1"/"0").
  // If we compile `field = true` into strict `userData.field===true`, conditional questions can be skipped incorrectly,
  // causing premature process completion (e.g., Flow 01 -> Flow 02 before collecting `referral_source`).
  //
  // We rewrite strict boolean equality comparisons into tolerant checks using only helpers already available
  // in the kseval scope: `__present` and standard JS string coercion.
  const TRUE_TOKENS = '["true","1","כן","חדש","new","y","yes"]';
  const FALSE_TOKENS = '["false","0","לא","קיים","existing","n","no"]';

  const trueRe = /\buserData\.([A-Za-z_][A-Za-z0-9_]*)\s*===\s*true\b/g;
  const falseRe = /\buserData\.([A-Za-z_][A-Za-z0-9_]*)\s*===\s*false\b/g;

  let out = String(compiledJs || '');

  out = out.replace(trueRe, (_m, field: string) =>
    `(__present(userData.${field}) && __includes(${TRUE_TOKENS}, String(userData.${field}).trim().toLowerCase()))`,
  );

  out = out.replace(falseRe, (_m, field: string) =>
    `(__present(userData.${field}) && __includes(${FALSE_TOKENS}, String(userData.${field}).trim().toLowerCase()))`,
  );

  return out;
}

export function compileConditionDslToJs(expr: string | null | undefined): string | null {
  const raw = String(expr ?? '').trim();
  if (!raw) return null;

  // Normalize boolean connectors
  let s = raw
    .replace(/\bAND\b/gi, '&&')
    .replace(/\bOR\b/gi, '||');

  // Normalize `includes` operator: <field> includes 'X'  -> __includes(<field>, 'X')
  // (we later prefix the field identifier with userData.)
  s = s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\s+includes\s+'([^']*)'/gi,
    '__includes($1, \'$2\')',
  );

  // Normalize equality operator
  s = replaceLooseEquality(s);

  // Prefix bare identifiers to userData.<id>
  s = prefixIdentifiersWithUserData(s);

  // Tolerate boolean-like values stored as strings/numbers
  s = rewriteBooleanEqualityComparisons(s);

  return s.trim();
}

function isRequiredModeRequired(requiredMode: string): boolean {
  const m = String(requiredMode || '').trim().toLowerCase();
  return m === 'required' || m === 'y' || m === 'yes';
}

function isRequiredModeConditional(requiredMode: string): boolean {
  const m = String(requiredMode || '').trim().toLowerCase();
  return m === 'conditional';
}

/**
 * Build a customCompletionCheck expression (condition-only mode) for a process file.
 *
 * The expression assumes it is evaluated with:
 *   - userData: Record<string, unknown>
 *   - __present(v): boolean
 *   - __includes(container, needle): boolean
 */
export function buildProcessCompletionExpression(procFile: RawProcessFileLike): string {
  const p = procFile?.process || {};
  const audience = String(p.audience || 'customer');

  // If not customer-facing, complete immediately.
  if (audience !== 'customer') return 'true';

  const procAskIf = compileConditionDslToJs(p.ask_if);

  // If the process ask_if does not hold, complete immediately (skip the process).
  const processIsActiveExpr = procAskIf ? `(${procAskIf})` : 'true';
  const skipExpr = procAskIf ? `!(${processIsActiveExpr})` : 'false';

  const questions: RawQuestion[] = Array.isArray(procFile?.questions) ? procFile.questions : [];

  const presenceExprForField = (fieldKey: string): string => {
    const k = String(fieldKey || '').trim();
    if (!k) return 'false';

    // Stricter validity for known fields to prevent premature completion on placeholders/internal ids.
    if (k === 'user_id') {
      // Israeli national ID: 9 digits (after stripping non-digits).
      // Do NOT accept UUIDs or arbitrary strings.
      return '(__present(userData.user_id)'
        + ' && /^[0-9\\s\\-\\.]+$/.test(String(userData.user_id).trim())'
        + ' && String(userData.user_id).replace(/\\D/g, \'\').length === 9)';
    }
    if (k === 'insured_relation_to_business') {
      // Must be one of the known options (Hebrew or English fallbacks).
      const TOKENS = '["בעלים","מורשה חתימה","מנהל","אחר","owner","authorized signer","manager","other"]';
      return '(__present(userData.insured_relation_to_business)'
        + ` && __includes(${TOKENS}, String(userData.insured_relation_to_business).trim().toLowerCase()))`;
    }
    if (k === 'referral_source') {
      // Require a non-trivial string (avoid single-char / placeholders).
      return '(__present(userData.referral_source) && String(userData.referral_source).trim().length >= 2)';
    }

    return `__present(userData.${k})`;
  };

  const reqChecks: string[] = [];
  for (const q of questions) {
    if (!q) continue;
    if (q.audience && String(q.audience) !== 'customer') continue;
    const fieldKey = String(q.field_key_en || '').trim();
    if (!fieldKey) continue;

    // Attachments are asynchronous; do not block completion on file uploads.
    if (String(q.input_type || '').toLowerCase() === 'file') continue;

    const requiredMode = String(q.required_mode || '').trim();
    const askIf = compileConditionDslToJs(q.ask_if);
    const requiredIf = compileConditionDslToJs(q.required_if);

    const isActiveExpr = askIf ? `(${askIf})` : 'true';

    let isRequiredNowExpr: string | null = null;
    if (isRequiredModeRequired(requiredMode)) {
      isRequiredNowExpr = isActiveExpr;
    } else if (isRequiredModeConditional(requiredMode)) {
      const cond = requiredIf ? `(${requiredIf})` : 'true';
      isRequiredNowExpr = `(${isActiveExpr} && ${cond})`;
    } else {
      // optional -> not required for completion
      isRequiredNowExpr = null;
    }

    if (!isRequiredNowExpr) continue;
    reqChecks.push(`(!(${isRequiredNowExpr}) || ${presenceExprForField(fieldKey)})`);
  }

  const allRequiredSatisfiedExpr = reqChecks.length ? reqChecks.join(' && ') : 'true';
  return `(${skipExpr}) || (${allRequiredSatisfiedExpr})`;
}
