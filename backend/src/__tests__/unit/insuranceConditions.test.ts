import { compileConditionDslToJs, evaluateCondition } from '../../lib/insurance/questionnaire/conditions';

describe('insurance condition DSL', () => {
  test('empty condition evaluates to true', () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition('', {})).toBe(true);
    expect(evaluateCondition('   ', {})).toBe(true);
  });

  test('boolean equality', () => {
    expect(evaluateCondition('ch1_contents_selected = true', { ch1_contents_selected: true })).toBe(true);
    expect(evaluateCondition('ch1_contents_selected = true', { ch1_contents_selected: false })).toBe(false);
    expect(evaluateCondition('ch1_contents_selected = false', { ch1_contents_selected: false })).toBe(true);
  });

  test('OR / AND with parentheses', () => {
    const expr = "(has_physical_premises = true) OR (ch1_contents_selected = true)";
    expect(evaluateCondition(expr, { has_physical_premises: true, ch1_contents_selected: false })).toBe(true);
    expect(evaluateCondition(expr, { has_physical_premises: false, ch1_contents_selected: true })).toBe(true);
    expect(evaluateCondition(expr, { has_physical_premises: false, ch1_contents_selected: false })).toBe(false);

    expect(evaluateCondition("a = true AND b = true", { a: true, b: true })).toBe(true);
    expect(evaluateCondition("a = true AND b = true", { a: true, b: false })).toBe(false);
  });

  test('includes operator works for arrays and strings', () => {
    expect(evaluateCondition("business_site_type includes 'משרד'", { business_site_type: ['משרד'] })).toBe(true);
    expect(evaluateCondition("business_site_type includes 'משרד'", { business_site_type: ['חנות'] })).toBe(false);
    expect(evaluateCondition("business_used_for includes 'משפט'", { business_used_for: 'ייעוץ משפטי וייצוג' })).toBe(true);
  });

  test('compileConditionDslToJs produces userData-prefixed JS', () => {
    const compiled = compileConditionDslToJs("a = true OR b = false");
    expect(compiled).toContain('userData.a');
    expect(compiled).toContain('||');
    expect(compiled).toContain('userData.b');
  });
});

