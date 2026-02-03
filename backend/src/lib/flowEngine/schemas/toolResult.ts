import { z } from 'zod';

/**
 * Zod schema for validating ToolResult types
 *
 * Use this schema to validate tool return values to ensure they match the expected structure.
 */

/**
 * ToolResult validation schema
 *
 * Validates that a tool executor returns a properly formatted result.
 *
 * @example
 * ```typescript
 * import { toolResultSchema } from './schemas/toolResult';
 *
 * const result = await myTool(payload, context);
 * const validated = toolResultSchema.parse(result);
 * ```
 */
export const toolResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  saveResults: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (result) => {
    // If success is true, error should not be present
    if (result.success && result.error) {
      return false;
    }
    // If success is false, error should be present
    if (!result.success && !result.error) {
      return false;
    }
    return true;
  },
  {
    message: 'success=true requires no error, success=false requires error',
  },
);

/**
 * Type-safe validation function for ToolResult
 *
 * @param result - Tool result to validate
 * @returns Validation result with parsed result or error details
 *
 * @example
 * ```typescript
 * import { validateToolResult } from './schemas/toolResult';
 *
 * const result = await myTool(payload, context);
 * const validated = validateToolResult(result);
 * if (!validated.success) {
 *   console.error('Invalid tool result:', validated.error);
 * }
 * ```
 */
export function validateToolResult(result: unknown): {
  success: boolean;
  data?: z.infer<typeof toolResultSchema>;
  error?: z.ZodError;
} {
  const parseResult = toolResultSchema.safeParse(result);
  if (parseResult.success) {
    return { success: true, data: parseResult.data };
  }
  return { success: false, error: parseResult.error };
}
