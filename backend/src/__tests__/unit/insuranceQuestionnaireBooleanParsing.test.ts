import { parseAndApplyAnswer, buildInitialQuestionnaireState } from '../../lib/insurance/questionnaire/engine';
import type { Questionnaire, QuestionnaireQuestion } from '../../lib/insurance/questionnaire/types';

describe('insurance questionnaire boolean parsing', () => {
  const questionnaire: Questionnaire = {
    meta: { name: 'test' },
    runtime: { engine_contract: { condition_dsl: 'simple', defaults: {}, derived_rules: [] } },
    stages: [],
    questions: [],
    modules_catalog: [],
    handoff_triggers: [],
    attachments_checklist: [],
    production_validations: [],
  };

  const q = {
    q_id: 'T1',
    stage_key: 'triage',
    audience: 'customer',
    prompt_he: 'test',
    field_key_en: 'has_employees',
    data_type: 'boolean',
    options_he: 'כן, לא',
    json_path: 'triage.has_employees',
  } satisfies QuestionnaireQuestion;

  test('parses Hebrew/English yes/no tokens', () => {
    const state = buildInitialQuestionnaireState(questionnaire, {}, {});

    expect(parseAndApplyAnswer(questionnaire, state, q, 'כן').ok).toBe(true);
    expect(state.vars.has_employees).toBe(true);

    const state2 = buildInitialQuestionnaireState(questionnaire, {}, {});
    expect(parseAndApplyAnswer(questionnaire, state2, q, 'לא').ok).toBe(true);
    expect(state2.vars.has_employees).toBe(false);
  });

  test('parses "חיובי"/"שלילי"', () => {
    const state = buildInitialQuestionnaireState(questionnaire, {}, {});

    expect(parseAndApplyAnswer(questionnaire, state, q, 'חיובי').ok).toBe(true);
    expect(state.vars.has_employees).toBe(true);

    const state2 = buildInitialQuestionnaireState(questionnaire, {}, {});
    expect(parseAndApplyAnswer(questionnaire, state2, q, 'שלילי').ok).toBe(true);
    expect(state2.vars.has_employees).toBe(false);
  });

  test('parses numeric prefixes as boolean (>0 => true, 0 => false)', () => {
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

