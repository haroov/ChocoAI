import { parseAndApplyAnswer, buildInitialQuestionnaireState } from '../../lib/insurance/questionnaire/engine';
import type { Questionnaire } from '../../lib/insurance/questionnaire/types';

describe('insurance questionnaire boolean parsing', () => {
  const questionnaire: Questionnaire = {
    meta: { name: 'test' } as any,
    runtime: { engine_contract: { defaults: {}, derived_rules: [] } } as any,
    stages: [],
    questions: [],
    modules_catalog: [],
    handoff_triggers: [],
    attachments_checklist: [],
    production_validations: [],
  };

  test('parses Hebrew/English yes/no tokens', () => {
    const state = buildInitialQuestionnaireState(questionnaire, {}, {});
    const q: any = { q_id: 'T1', field_key_en: 'has_employees', data_type: 'boolean', options_he: 'כן, לא', json_path: 'triage.has_employees' };

    expect(parseAndApplyAnswer(questionnaire, state, q, 'כן').ok).toBe(true);
    expect(state.vars.has_employees).toBe(true);

    const state2 = buildInitialQuestionnaireState(questionnaire, {}, {});
    expect(parseAndApplyAnswer(questionnaire, state2, q, 'לא').ok).toBe(true);
    expect(state2.vars.has_employees).toBe(false);
  });

  test('parses "חיובי"/"שלילי"', () => {
    const state = buildInitialQuestionnaireState(questionnaire, {}, {});
    const q: any = { q_id: 'T1', field_key_en: 'has_employees', data_type: 'boolean', options_he: 'כן, לא', json_path: 'triage.has_employees' };

    expect(parseAndApplyAnswer(questionnaire, state, q, 'חיובי').ok).toBe(true);
    expect(state.vars.has_employees).toBe(true);

    const state2 = buildInitialQuestionnaireState(questionnaire, {}, {});
    expect(parseAndApplyAnswer(questionnaire, state2, q, 'שלילי').ok).toBe(true);
    expect(state2.vars.has_employees).toBe(false);
  });

  test('parses numeric prefixes as boolean (>0 => true, 0 => false)', () => {
    const q: any = { q_id: 'T1', field_key_en: 'has_employees', data_type: 'boolean', options_he: 'כן, לא', json_path: 'triage.has_employees' };

    const state = buildInitialQuestionnaireState(questionnaire, {}, {});
    expect(parseAndApplyAnswer(questionnaire, state, q, '3').ok).toBe(true);
    expect(state.vars.has_employees).toBe(true);

    const state2 = buildInitialQuestionnaireState(questionnaire, {}, {});
    expect(parseAndApplyAnswer(questionnaire, state2, q, '0').ok).toBe(true);
    expect(state2.vars.has_employees).toBe(false);

    const state3 = buildInitialQuestionnaireState(questionnaire, {}, {});
    expect(parseAndApplyAnswer(questionnaire, state3, q, '12 עובדים').ok).toBe(true);
    expect(state3.vars.has_employees).toBe(true);
  });
});

