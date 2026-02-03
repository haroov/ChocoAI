import { z } from 'zod';

/**
 * Zod schema for validating FlowSchema types
 *
 * Use this schema to validate flow definitions at runtime to catch errors early.
 */

/**
 * Error handling behavior enum schema
 */
const errorHandlingBehaviorSchema = z.enum(['pause', 'newStage', 'continue', 'endFlow']);

/**
 * Error handling configuration schema
 */
export const errorHandlingConfigSchema = z.object({
  behavior: errorHandlingBehaviorSchema,
  emailTo: z.string().email().optional(),
  emailSubject: z.string().optional(),
  includeDetails: z.boolean().optional(),
  nextStage: z.string().optional(),
  message: z.string().optional(),
});

/**
 * Field definition schema
 */
export const fieldDefinitionSchema = z.object({
  type: z.enum(['string', 'boolean', 'number']),
  description: z.string().min(1),
  sensitive: z.boolean().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

/**
 * Error code handler schema
 */
const errorCodeHandlerSchema = z.object({
  updateUserData: z.record(z.string()).optional(),
  behavior: errorHandlingBehaviorSchema.optional(),
  nextStage: z.string().optional(),
});

/**
 * Stage action schema
 */
const stageActionSchema = z.object({
  toolName: z.string().min(1),
  condition: z.string().optional(),
  allowReExecutionOnError: z.boolean().optional(),
  onErrorCode: z.record(errorCodeHandlerSchema).optional(),
  onError: errorHandlingConfigSchema.optional(),
});

/**
 * Conditional next stage schema
 */
const conditionalNextStageSchema = z.object({
  conditional: z.array(
    z.object({
      condition: z.string().min(1),
      ifTrue: z.string().min(1),
      ifFalse: z.string().optional(),
    }),
  ).min(1),
  fallback: z.string().min(1),
});

/**
 * Next stage schema (can be string or conditional object)
 */
const nextStageSchema = z.union([
  z.string().min(1),
  conditionalNextStageSchema,
]);

/**
 * Flow stage definition schema
 */
export const flowStageDefinitionSchema = z.object({
  name: z.string().optional(),
  description: z.string().min(1),
  prompt: z.string().optional(),
  fieldsToCollect: z.array(z.string()).min(0),
  context: z.array(z.string()).optional(),
  adaptiveToneEnabled: z.boolean().optional(),
  action: stageActionSchema.optional(),
  onError: errorHandlingConfigSchema.optional(),
  nextStage: nextStageSchema.optional(),
});

/**
 * Flow schema config schema
 */
export const flowSchemaConfigSchema = z.object({
  initialStage: z.string().min(1),
  defaultForNewUsers: z.boolean().optional(),
  onComplete: z.object({
    startFlowSlug: z.string().min(1),
    mode: z.enum(['seamless', 'ask']).optional(),
    preserveFields: z.array(z.string()).optional(),
  }).optional(),
  isRouterFlow: z.boolean().optional(),
  errorHandlingStrategy: z.object({
    onUnhandledError: z.enum(['killFlow', 'skip']).optional(),
  }).optional(),
});

/**
 * Flow definition schema (stages, fields, config)
 */
export const flowDefinitionSchema = z.object({
  stages: z.record(z.string(), flowStageDefinitionSchema).refine(
    (stages) => Object.keys(stages).length > 0,
    { message: 'Flow must have at least one stage' },
  ),
  fields: z.record(z.string(), fieldDefinitionSchema),
  config: flowSchemaConfigSchema,
});

/**
 * Complete FlowSchema validation schema
 *
 * Use this to validate a complete flow schema at runtime.
 *
 * @example
 * ```typescript
 * import { flowSchemaSchema } from './schemas/flowSchema';
 *
 * try {
 *   flowSchemaSchema.parse(myFlow);
 *   console.log('Flow schema is valid!');
 * } catch (error) {
 *   console.error('Invalid flow schema:', error);
 * }
 * ```
 */
export const flowSchemaSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1),
  version: z.number().int().positive(),
  definition: flowDefinitionSchema,
}).refine(
  (schema) => {
    // Validate that initialStage exists in stages
    const { initialStage } = schema.definition.config;
    return initialStage in schema.definition.stages;
  },
  {
    message: 'initialStage must exist in stages',
    path: ['definition', 'config', 'initialStage'],
  },
).refine(
  (schema) => {
    // Validate that all fieldsToCollect reference existing fields
    const fieldKeys = Object.keys(schema.definition.fields);
    for (const stage of Object.values(schema.definition.stages)) {
      for (const field of stage.fieldsToCollect) {
        if (!fieldKeys.includes(field)) {
          return false;
        }
      }
    }
    return true;
  },
  {
    message: 'All fieldsToCollect must reference existing fields',
  },
).refine(
  (schema) => {
    // Validate that all nextStage references exist
    const stageKeys = Object.keys(schema.definition.stages);
    for (const stage of Object.values(schema.definition.stages)) {
      if (stage.nextStage) {
        if (typeof stage.nextStage === 'string') {
          if (!stageKeys.includes(stage.nextStage)) {
            return false;
          }
        } else {
          // Conditional nextStage
          if (!stageKeys.includes(stage.nextStage.fallback)) {
            return false;
          }
          for (const conditional of stage.nextStage.conditional) {
            if (!stageKeys.includes(conditional.ifTrue)) {
              return false;
            }
            if (conditional.ifFalse && !stageKeys.includes(conditional.ifFalse)) {
              return false;
            }
          }
        }
      }
    }
    return true;
  },
  {
    message: 'All nextStage references must point to existing stages',
  },
);

/**
 * Type-safe validation function for FlowSchema
 *
 * @param schema - Flow schema to validate
 * @returns Validation result with parsed schema or error details
 */
export function validateFlowSchema(schema: unknown): {
  success: boolean;
  data?: z.infer<typeof flowSchemaSchema>;
  error?: z.ZodError;
} {
  const result = flowSchemaSchema.safeParse(schema);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
