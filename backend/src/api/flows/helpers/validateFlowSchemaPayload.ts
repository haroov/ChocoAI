import { FlowSchema } from '../../../lib/flowEngine';

export const validateFlowSchemaPayload = (schema: FlowSchema): { ok: true } | { ok: false; error: string } => {
  if (!schema || typeof schema !== 'object') return { ok: false, error: 'Schema must be an object' };

  const requiredTop = ['name', 'slug', 'description', 'definition'];
  for (const k of requiredTop) if (!(k in schema)) return { ok: false, error: `Missing field: ${k}` };

  const { definition } = schema;

  if (!schema.name || typeof schema.name !== 'string') return { ok: false, error: 'name must be a non-empty string' };
  if (!schema.slug || typeof schema.slug !== 'string') return { ok: false, error: 'slug must be a non-empty string' };
  if (!schema.description || typeof schema.description !== 'string') return { ok: false, error: 'description must be a string' };
  if (!definition.stages || typeof definition.stages !== 'object') return { ok: false, error: 'stages must be an object' };
  if (!definition.fields || typeof definition.fields !== 'object') return { ok: false, error: 'fields must be an object' };
  if (!definition.config || typeof definition.config !== 'object') return { ok: false, error: 'config must be an object' };
  if (!definition.config.initialStage || typeof definition.config.initialStage !== 'string') return { ok: false, error: 'config.initialStage must be a string' };
  if (!definition.stages[definition.config.initialStage]) return { ok: false, error: `Initial stage '${definition.config.initialStage}' not found in stages` };

  // Validate stages
  for (const [stageSlug, stage] of Object.entries<any>(definition.stages)) {
    if (!stage || typeof stage !== 'object') return { ok: false, error: `Stage '${stageSlug}' must be an object` };
    if (!('description' in stage) || typeof stage.description !== 'string') return { ok: false, error: `Stage '${stageSlug}' missing description` };
    if (stage.prompt != null && typeof stage.prompt !== 'string') return { ok: false, error: `Stage '${stageSlug}' prompt must be a string when provided` };
    if (!Array.isArray(stage.fieldsToCollect)) return { ok: false, error: `Stage '${stageSlug}' fieldsToCollect must be an array` };
    for (const f of stage.fieldsToCollect) {
      if (!(f in definition.fields)) return { ok: false, error: `Stage '${stageSlug}' references unknown field '${f}'` };
    }

    // Validate action (minimal shape checks)
    if (stage.action != null) {
      if (typeof stage.action !== 'object') return { ok: false, error: `Stage '${stageSlug}' action must be an object` };
      if (typeof stage.action.toolName !== 'string' || !stage.action.toolName.trim()) {
        return { ok: false, error: `Stage '${stageSlug}' action.toolName must be a non-empty string` };
      }
      if (stage.action.condition != null && (typeof stage.action.condition !== 'string' || !stage.action.condition.trim())) {
        return { ok: false, error: `Stage '${stageSlug}' action.condition must be a non-empty string when provided` };
      }
      if (stage.action.allowReExecutionOnError != null && typeof stage.action.allowReExecutionOnError !== 'boolean') {
        return { ok: false, error: `Stage '${stageSlug}' action.allowReExecutionOnError must be a boolean when provided` };
      }

      // Validate onErrorCode handlers (if present)
      if (stage.action.onErrorCode != null) {
        if (typeof stage.action.onErrorCode !== 'object') {
          return { ok: false, error: `Stage '${stageSlug}' action.onErrorCode must be an object when provided` };
        }
        for (const [code, handler] of Object.entries<any>(stage.action.onErrorCode)) {
          if (!handler || typeof handler !== 'object') {
            return { ok: false, error: `Stage '${stageSlug}' action.onErrorCode['${code}'] must be an object` };
          }
          if (handler.updateUserData != null && typeof handler.updateUserData !== 'object') {
            return { ok: false, error: `Stage '${stageSlug}' action.onErrorCode['${code}'].updateUserData must be an object when provided` };
          }
          if (handler.updateUserData) {
            for (const [k, expr] of Object.entries<any>(handler.updateUserData)) {
              if (typeof expr !== 'string' || !expr.trim()) {
                return { ok: false, error: `Stage '${stageSlug}' action.onErrorCode['${code}'].updateUserData['${k}'] must be a non-empty string expression` };
              }
            }
          }
        }
      }
    }

    // Transitions validation: support legacy nextState (string) and new nextStage (string | conditional object)
    const next = stage.nextStage ?? stage.nextState;
    if (next != null) {
      if (typeof next === 'string') {
        if (!(next in definition.stages)) return { ok: false, error: `Stage '${stageSlug}' nextStage '${next}' not found` };
      } else if (typeof next === 'object') {
        // conditional object
        const cond = (next as any).conditional;
        const { fallback } = (next as any);
        if (!Array.isArray(cond)) return { ok: false, error: `Stage '${stageSlug}' nextStage.conditional must be an array` };
        for (let i = 0; i < cond.length; i++) {
          const rule = cond[i];
          if (!rule || typeof rule !== 'object') return { ok: false, error: `Stage '${stageSlug}' conditional[${i}] must be an object` };
          if (typeof rule.condition !== 'string' || !rule.condition.trim()) return { ok: false, error: `Stage '${stageSlug}' conditional[${i}].condition must be a non-empty string` };
          if (typeof rule.ifTrue !== 'string' || !(rule.ifTrue in definition.stages)) return { ok: false, error: `Stage '${stageSlug}' conditional[${i}].ifTrue '${rule.ifTrue}' not found` };
          if (rule.ifFalse != null && (typeof rule.ifFalse !== 'string' || !(rule.ifFalse in definition.stages))) return { ok: false, error: `Stage '${stageSlug}' conditional[${i}].ifFalse '${rule.ifFalse}' not found` };
        }
        if (typeof fallback !== 'string' || !(fallback in definition.stages)) return { ok: false, error: `Stage '${stageSlug}' nextStage.fallback '${fallback}' not found` };
      } else {
        return { ok: false, error: `Stage '${stageSlug}' nextStage must be a string or conditional object` };
      }
    }
  }

  // Validate fields
  const allowedTypes = new Set(['string', 'number', 'boolean']);
  for (const [fieldSlug, field] of Object.entries<any>(definition.fields)) {
    if (!field || typeof field !== 'object') return { ok: false, error: `Field '${fieldSlug}' must be an object` };
    if (!allowedTypes.has(field.type)) return { ok: false, error: `Field '${fieldSlug}' has invalid type '${field.type}'` };
    if (field.enum && !Array.isArray(field.enum)) return { ok: false, error: `Field '${fieldSlug}' enum must be an array` };
  }

  return { ok: true };
};
