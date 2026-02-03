/**
 * Execution context provided to tool executors
 */
export type ToolExecutionContext = {
  /** The conversation ID where this tool is being executed */
  conversationId: string;
};

/**
 * Result returned by a tool executor
 *
 * @template T - Type of data returned on success
 *
 * @example
 * ```typescript
 * {
 *   success: true,
 *   data: { userId: '123', orgId: '456' },
 *   saveResults: { org_customer_id: '456' },
 * }
 * ```
 *
 * @example
 * ```typescript
 * {
 *   success: false,
 *   error: 'API call failed',
 * }
 * ```
 */
export type ToolResult<T = any> = {
  /** Whether the tool execution was successful */
  success: boolean;
  /** Data returned on successful execution */
  data?: T;
  /** Error message if execution failed */
  error?: string;
  /** Optional error code for structured error handling (e.g., 'ALREADY_REGISTERED', 'WRONG_CODE', 'ENTITY_PUSH_FAILED') */
  errorCode?: string;
  /** Optional HTTP status code if error came from HTTP request */
  status?: number;
  /** Optional fields to automatically save to userData (keyed by field slug) */
  saveResults?: Record<string, any>;
};

/**
 * Tool executor function signature
 *
 * Tools are functions that execute actions during flow processing (e.g., API calls, data transformations)
 *
 * @template TInput - Type of input payload
 * @template TResult - Type of result data
 *
 * @param input - Payload data (typically userData or specific fields)
 * @param context - Execution context with conversationId
 * @returns Promise resolving to ToolResult
 *
 * @example
 * ```typescript
 * export const myTool: ToolExecutor<{ name: string }, { id: string }> = async (
 *   payload,
 *   { conversationId }
 * ) => {
 *   try {
 *     const result = await doSomething(payload.name);
 *     return {
 *       success: true,
 *       data: { id: result.id },
 *       saveResults: { user_id: result.id },
 *     };
 *   } catch (error) {
 *     return {
 *       success: false,
 *       error: error.message,
 *     };
 *   }
 * };
 * ```
 */
export type ToolExecutor<TInput = any, TResult = any> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<ToolResult<TResult>>;
