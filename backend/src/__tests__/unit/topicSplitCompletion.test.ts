import kseval from 'kseval';
import {
  buildProcessCompletionExpression,
  compileConditionDslToJs,
} from '../../lib/flowEngine/builtInFlows/chocoClalSmbTopicSplitCompletion';

function __present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  // boolean false is a valid answer
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

function evalExpr(expr: string, userData: Record<string, unknown>): boolean {
  if (!kseval.native) {
    throw new Error('kseval.native is not available in this environment');
  }
  return Boolean(kseval.native.evaluate(expr, { userData, __present, __includes }));
}

describe('topic-split condition DSL compiler', () => {
  test('compiles equality with no spaces', () => {
    const js = compileConditionDslToJs('ch1_contents_selected=true');
    expect(js).toContain('userData.ch1_contents_selected');
    expect(js).toContain('__present(');
  });

  test('compiles AND/OR and includes', () => {
    const js = compileConditionDslToJs("cyber_selected=true AND business_site_type includes 'אחר'");
    expect(js).toContain('userData.cyber_selected');
    expect(js).toContain('__present(');
    expect(js).toContain("&& __includes(userData.business_site_type, 'אחר')");
  });

  test('compiles includes operator', () => {
    const js = compileConditionDslToJs("business_site_type includes 'אחר'");
    expect(js).toBe("__includes(userData.business_site_type, 'אחר')");
  });
});

describe('topic-split process completion expression', () => {
  test('completes immediately when process ask_if is false', () => {
    const procFile = {
      process: { audience: 'customer', ask_if: 'foo = true' },
      questions: [
        { field_key_en: 'a', required_mode: 'required', input_type: 'text' },
      ],
    };
    const expr = buildProcessCompletionExpression(procFile);
    expect(evalExpr(expr, { foo: false })).toBe(true);
    expect(evalExpr(expr, {})).toBe(true);
  });

  test('requires required questions when process is active', () => {
    const procFile = {
      process: { audience: 'customer', ask_if: 'foo = true' },
      questions: [
        { field_key_en: 'a', required_mode: 'required', input_type: 'text' },
      ],
    };
    const expr = buildProcessCompletionExpression(procFile);
    expect(evalExpr(expr, { foo: true })).toBe(false);
    expect(evalExpr(expr, { foo: true, a: 'x' })).toBe(true);
  });

  test('conditional requirement respects required_if and ask_if', () => {
    const procFile = {
      process: { audience: 'customer', ask_if: null },
      questions: [
        { field_key_en: 'x', required_mode: 'required', input_type: 'yes_no' },
        {
          field_key_en: 'b',
          required_mode: 'conditional',
          required_if: 'x = true',
          ask_if: "business_site_type includes 'אחר'",
          input_type: 'text',
        },
      ],
    };
    const expr = buildProcessCompletionExpression(procFile);

    // x is required
    expect(evalExpr(expr, { x: false })).toBe(true); // x answered, b not required (required_if false)
    expect(evalExpr(expr, { x: true })).toBe(true); // b is not required unless ask_if holds too

    // ask_if false -> b not required
    expect(evalExpr(expr, { x: true, business_site_type: ['משרד'] })).toBe(true);

    // ask_if true -> b required
    expect(evalExpr(expr, { x: true, business_site_type: ['אחר'] })).toBe(false);
    expect(evalExpr(expr, { x: true, business_site_type: ['אחר'], b: 'פירוט' })).toBe(true);
  });

  test('boolean ask_if tolerates string booleans (regression: Flow 01 referral_source)', () => {
    const procFile = {
      process: { audience: 'customer', ask_if: null },
      questions: [
        { field_key_en: 'is_new_customer', required_mode: 'required', input_type: 'select' },
        { field_key_en: 'referral_source', required_mode: 'required', ask_if: 'is_new_customer = true', input_type: 'text' },
      ],
    };
    const expr = buildProcessCompletionExpression(procFile);

    // If is_new_customer is mistakenly persisted as "true", we must STILL require referral_source.
    expect(evalExpr(expr, { is_new_customer: 'true' })).toBe(false);
    expect(evalExpr(expr, { is_new_customer: 'true', referral_source: 'גוגל' })).toBe(true);

    // Also tolerate WhatsApp-style "1"/Hebrew tokens.
    expect(evalExpr(expr, { is_new_customer: '1' })).toBe(false);
    expect(evalExpr(expr, { is_new_customer: 'חדש' })).toBe(false);
    expect(evalExpr(expr, { is_new_customer: 'חדש', referral_source: 'המלצה' })).toBe(true);
  });

  test('file questions do not block completion', () => {
    const procFile = {
      process: { audience: 'customer', ask_if: null },
      questions: [
        { field_key_en: 'a', required_mode: 'required', input_type: 'text' },
        { field_key_en: 'file_attachment', required_mode: 'required', input_type: 'file' },
      ],
    };
    const expr = buildProcessCompletionExpression(procFile);
    expect(evalExpr(expr, { a: 'ok' })).toBe(true);
  });
});

