import kseval from 'kseval';
import { logger } from '../../../utils/logger';

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
  // Prefix bare identifiers (field keys) with userData.<id>, except for reserved words/functions.
  const reserved = new Set<string>([
    'true', 'false', 'null', 'undefined',
    'NaN', 'Infinity',
    // operators / words we emit
    '&&', '||',
    // helper functions we inject
    '__includes', '__present',
    // globals
    'Math', 'Number', 'String', 'Array', 'Object',
  ]);

  let out = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      out += ch;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
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
  // Same rationale as topic-split compiler:
  // tolerate boolean-like values persisted as strings (or numbered selects), so `a = true` works even if a="true".
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

  // Normalize equality operator (single '=' -> '===')
  s = replaceLooseEquality(s);

  // Prefix bare identifiers to userData.<id>
  s = prefixIdentifiersWithUserData(s);

  // Tolerate boolean-like values stored as strings/numbers
  s = rewriteBooleanEqualityComparisons(s);

  return s.trim();
}

function isPresentValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return false;
    const lowered = s.toLowerCase();
    if (lowered === 'null' || lowered === ':null' || lowered === 'undefined' || lowered === ':undefined') return false;
    return true;
  }
  if (Array.isArray(v)) return v.length > 0;
  // boolean false is a valid value
  return true;
}

function __includes(container: unknown, needle: unknown): boolean {
  if (container === null || container === undefined) return false;
  const n = String(needle ?? '');
  if (!n) return false;
  if (Array.isArray(container)) return container.map(String).includes(n);
  if (typeof container === 'string') return container.includes(n);
  return false;
}

/**
 * Evaluates the questionnaire/router condition DSL against a vars object.
 *
 * DSL examples:
 * - `ch1_contents_selected = true`
 * - `(has_physical_premises = true) OR (ch2_building_selected = true)`
 * - `business_site_type includes 'משרד'`
 */
export function evaluateCondition(condition: string | null | undefined, vars: Record<string, unknown>): boolean {
  const compiled = compileConditionDslToJs(condition);
  if (!compiled) return true;

  try {
    const scope = {
      userData: vars || {},
      __includes,
      __present: isPresentValue,
    };

    if (kseval.native) {
      return Boolean(kseval.native.evaluate(compiled, scope));
    }

    // Best-effort fallback (should not happen in supported environments)
    const fn = new Function('userData', '__includes', '__present', `return (${compiled});`);
    return Boolean(fn(scope.userData, __includes, isPresentValue));
  } catch (e: any) {
    logger.warn('[conditions] Failed to evaluate condition', {
      condition: String(condition || ''),
      compiled,
      error: e?.message,
    });
    return false;
  }
}
