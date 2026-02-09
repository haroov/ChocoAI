export type QuestionnaireDerivedRule = {
  target_field: string;
  set_when: string;
  value: unknown;
  maps_to_q_id: string;
};

export type QuestionnaireEngineContract = {
  condition_dsl: 'simple';
  defaults: Record<string, unknown>;
  derived_rules?: QuestionnaireDerivedRule[];
  attachments_strategy?: string;
  channel_profiles?: Record<string, {
    max_questions_per_turn?: number;
    max_chars_per_message?: number;
    supports_quick_replies?: boolean;
    supports_multi_select?: boolean | string;
    supports_file_upload?: boolean;
    preferred_answer_formats?: string[];
  }>;
  resume_strategy?: {
    checkpoint_after_each_stage?: boolean;
    resume_message_he?: string;
  };
};

export type QuestionnaireStage = {
  stage_key: string;
  title_he: string;
  ask_if: string | null;
  intro_he?: string;
  intro_whatsapp_he?: string;
  stage_policies?: Record<string, { max_questions_per_turn?: number }>;
  completion_checkpoint?: {
    send_summary?: boolean;
    summary_template_he?: string;
  };
  question_ids: string[];
};

export type QuestionnaireQuestion = {
  q_id: string;
  stage_key: string;
  audience: 'customer' | 'internal';
  prompt_he: string;
  question_he?: string;
  field_key_en: string;
  data_type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'date';
  input_type?: string;
  options_he?: string;
  required?: 'Y' | 'N' | 'Conditional' | string;
  required_mode?: 'required' | 'optional' | 'conditional' | string;
  required_if?: string;
  ask_if?: string;
  constraints?: string;
  validation?: Record<string, unknown>;
  notes_logic?: string;
  json_path: string;
  module_key?: string;
  collection_mode?: 'derived' | 'direct' | string;
  prompt_variants?: Record<string, string>;
  priority?: number;
  whatsapp_rendering?: Record<string, unknown>;
};

export type QuestionnaireModule = {
  module_key: string;
  title_he: string;
  enable_if: string;
  audience?: 'customer' | 'internal';
};

export type ProductionValidation = {
  name: string;
  field_key_en: string;
  when: string;
  rule: {
    min?: number;
    max?: number;
    multipleOf?: number;
  };
  error_he: string;
};

export type HandoffTrigger = {
  trigger_key: string;
  when: string;
  reason_he: string;
  action: 'route_to_underwriter' | string;
};

export type AttachmentChecklistItem = {
  q_id: string;
  field_key_en: string;
  title_he: string;
  when: string | null;
  json_path: string;
  notes?: string;
};

export type Questionnaire = {
  meta: Record<string, unknown>;
  // Old format: engine_contract at top-level (kept for backward compat)
  engine_contract?: QuestionnaireEngineContract;
  // PROD format: runtime.engine_contract
  runtime?: {
    engine_contract: QuestionnaireEngineContract;
    conversation_policies?: Record<string, unknown>;
  };
  modules_catalog?: QuestionnaireModule[];
  stages: QuestionnaireStage[];
  questions: QuestionnaireQuestion[];
  production_validations?: ProductionValidation[];
  handoff_triggers?: HandoffTrigger[];
  attachments_checklist?: AttachmentChecklistItem[];
};

export type QuestionnaireNextQuestion = {
  q_id: string;
  stage_key: string;
  stage_title_he: string;
  prompt_he: string;
  field_key_en: string;
  data_type: QuestionnaireQuestion['data_type'];
  input_type?: string;
  options_he?: string;
  constraints?: string;
  required_if?: string;
  ask_if?: string;
  json_path: string;
};
