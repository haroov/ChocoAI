/**
 * Choco - SMB Business Insurance Quote Flow
 * Production-ready flow that uses the dynamic runner (insuranceQuestionnaireAnswerTool)
 * and the JSON configuration (MANIFEST.PROD.json + modular files).
 */

import { FlowSchema } from '../../types';

/**
 * Common transition logic for all questionnaire stages.
 * Routes to the appropriate stage based on `questionnaire_stage_key` in userData.
 */
const commonTransitions = {
  conditional: [
    { condition: "questionnaire_complete === true", ifTrue: "done" },
    { condition: "questionnaire_stage_key === '01_welcome_user'", ifTrue: "stage_01_welcome_user" },
    { condition: "questionnaire_stage_key === '02_intent_segment_and_coverages'", ifTrue: "stage_02_intent_segment_and_coverages" },
    { condition: "questionnaire_stage_key === '03_premises_building_characteristics'", ifTrue: "stage_03_premises_building_characteristics" },
    { condition: "questionnaire_stage_key === '04_premises_environment_and_water'", ifTrue: "stage_04_premises_environment_and_water" },
    { condition: "questionnaire_stage_key === '05_premises_security_fire_and_burglary'", ifTrue: "stage_05_premises_security_fire_and_burglary" },
    { condition: "questionnaire_stage_key === '06_premises_licenses_and_liens'", ifTrue: "stage_06_premises_licenses_and_liens" },
    { condition: "questionnaire_stage_key === '07_property_contents'", ifTrue: "stage_07_property_contents" },
    { condition: "questionnaire_stage_key === '08_property_inventory_stock'", ifTrue: "stage_08_property_inventory_stock" },
    { condition: "questionnaire_stage_key === '09_property_building_coverage'", ifTrue: "stage_09_property_building_coverage" },
    { condition: "questionnaire_stage_key === '10_business_interruption'", ifTrue: "stage_10_business_interruption" },
    { condition: "questionnaire_stage_key === '11_burglary_and_robbery'", ifTrue: "stage_11_burglary_and_robbery" },
    { condition: "questionnaire_stage_key === '12_money_all_risks'", ifTrue: "stage_12_money_all_risks" },
    { condition: "questionnaire_stage_key === '13_property_in_transit'", ifTrue: "stage_13_property_in_transit" },
    { condition: "questionnaire_stage_key === '14_electronic_equipment'", ifTrue: "stage_14_electronic_equipment" },
    { condition: "questionnaire_stage_key === '15_third_party_liability'", ifTrue: "stage_15_third_party_liability" },
    { condition: "questionnaire_stage_key === '16_employers_liability'", ifTrue: "stage_16_employers_liability" },
    { condition: "questionnaire_stage_key === '17_product_liability_profile_and_sales'", ifTrue: "stage_17_product_liability_profile_and_sales" },
    { condition: "questionnaire_stage_key === '18_product_liability_risk_and_extensions'", ifTrue: "stage_18_product_liability_risk_and_extensions" },
    { condition: "questionnaire_stage_key === '19_cyber_annex'", ifTrue: "stage_19_cyber_annex" },
    { condition: "questionnaire_stage_key === '20_terror_annex'", ifTrue: "stage_20_terror_annex" },
    { condition: "questionnaire_stage_key === '21_history_and_disclosures'", ifTrue: "stage_21_history_and_disclosures" },
    { condition: "questionnaire_stage_key === '22_customer_declarations_and_signatures'", ifTrue: "stage_22_customer_declarations_and_signatures" },
    { condition: "questionnaire_stage_key === '23_internal_agent_section'", ifTrue: "stage_23_internal_agent_section" },
  ],
  // Fallback: stay on current stage (we rely on the specific stage definition to set fallback to itself, 
  // but here we might default to 01 if lost)
  fallback: "stage_01_welcome_user"
};

const chocoClalSmbQuoteFlow: FlowSchema = {
  name: 'Choco - Clal SMB Quote (Business Insurance)',
  slug: 'choco-clal-smb-quote',
  description: 'Full end-to-end proposal flow for Clal SMB insurance (Modular)',
  version: 20260205, // Updated for modular split
  definition: {
    config: {
      initialStage: 'initQuestionnaire',
      defaultForNewUsers: true,
      onComplete: {
        startFlowSlug: 'welcome',
        mode: 'seamless'
      }
    },
    stages: {
      // --- Initialization ---
      initQuestionnaire: {
        description: 'Initialize the questionnaire engine',
        fieldsToCollect: [],
        action: {
          toolName: 'insurance.questionnaire.init',
          condition: 'true',
          allowReExecutionOnError: true
        },
        nextStage: {
          ...commonTransitions,
          fallback: "stage_01_welcome_user"
        }
      },

      // --- Modular Stages ---
      stage_01_welcome_user: {
        description: '01 Welcome & Contact',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_01_welcome_user" }
      },
      stage_02_intent_segment_and_coverages: {
        description: '02 Intent & Coverages',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_02_intent_segment_and_coverages" }
      },
      stage_03_premises_building_characteristics: {
        description: '03 Premises Building',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_03_premises_building_characteristics" }
      },
      stage_04_premises_environment_and_water: {
        description: '04 Environment & Water',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_04_premises_environment_and_water" }
      },
      stage_05_premises_security_fire_and_burglary: {
        description: '05 Security & Fire',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_05_premises_security_fire_and_burglary" }
      },
      stage_06_premises_licenses_and_liens: {
        description: '06 Licenses & Liens',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_06_premises_licenses_and_liens" }
      },
      stage_07_property_contents: {
        description: '07 Property Contents',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_07_property_contents" }
      },
      stage_08_property_inventory_stock: {
        description: '08 Inventory Stock',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_08_property_inventory_stock" }
      },
      stage_09_property_building_coverage: {
        description: '09 Building Coverage',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_09_property_building_coverage" }
      },
      stage_10_business_interruption: {
        description: '10 Business Interruption',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_10_business_interruption" }
      },
      stage_11_burglary_and_robbery: {
        description: '11 Burglary & Robbery',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_11_burglary_and_robbery" }
      },
      stage_12_money_all_risks: {
        description: '12 Money All Risks',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_12_money_all_risks" }
      },
      stage_13_property_in_transit: {
        description: '13 Property In Transit',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_13_property_in_transit" }
      },
      stage_14_electronic_equipment: {
        description: '14 Electronic Equipment',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_14_electronic_equipment" }
      },
      stage_15_third_party_liability: {
        description: '15 Third Party Liability',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_15_third_party_liability" }
      },
      stage_16_employers_liability: {
        description: '16 Employers Liability',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_16_employers_liability" }
      },
      stage_17_product_liability_profile_and_sales: {
        description: '17 Product Liability Profile',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_17_product_liability_profile_and_sales" }
      },
      stage_18_product_liability_risk_and_extensions: {
        description: '18 Product Risks',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_18_product_liability_risk_and_extensions" }
      },
      stage_19_cyber_annex: {
        description: '19 Cyber Annex',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_19_cyber_annex" }
      },
      stage_20_terror_annex: {
        description: '20 Terror Annex',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_20_terror_annex" }
      },
      stage_21_history_and_disclosures: {
        description: '21 History & Disclosures',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_21_history_and_disclosures" }
      },
      stage_22_customer_declarations_and_signatures: {
        description: '22 Declarations & Signatures',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_22_customer_declarations_and_signatures" }
      },
      stage_23_internal_agent_section: {
        description: '23 Internal Agent Section',
        prompt: '{questionnaire_stage_intro_to_send}\n\n{questionnaire_prompt_he}\n{questionnaire_options_he}',
        fieldsToCollect: ['questionnaire_answer'],
        action: { toolName: 'insurance.questionnaire.answer', condition: 'true', allowReExecutionOnError: true },
        nextStage: { ...commonTransitions, fallback: "stage_23_internal_agent_section" }
      },

      // --- Completion ---
      done: {
        description: 'Flow complete (Proposal Ready)',
        prompt: 'תודה רבה! סיימנו את איסוף הפרטים.',
        fieldsToCollect: [],
        nextStage: 'done' // End state
      }
    },
    fields: {
      questionnaire_answer: {
        type: 'string',
        description: 'The user answer to the current questionnaire question.'
      },
      questionnaire_stage_intro_to_send: {
        type: 'string',
        description: 'Optional intro text for the stage switch'
      },
      questionnaire_prompt_he: {
        type: 'string',
        description: 'The Hebrew prompt for the current question'
      },
      questionnaire_options_he: {
        type: 'string',
        description: 'Optional options list for the question'
      }
    }
  }
};

export default chocoClalSmbQuoteFlow;

