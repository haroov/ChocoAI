import { logger } from '../../../utils/logger';
import { ToolExecutionContext, ToolResult } from './types';

/**
 * Executes dynamic tool code
 * NOTE: In production, this should use a proper sandboxed environment (e.g., vm2, isolated-vm, or a separate service)
 * For now, we'll use Function constructor with limited scope
 */
export async function executeDynamicTool(
  toolCode: string,
  payload: any,
  context: ToolExecutionContext,
): Promise<ToolResult<any>> {
  try {
    // In production, use a proper sandboxed VM (vm2, isolated-vm, or separate service)
    // For now, we'll use Function constructor with a timeout
    const executor = new Function('payload', 'context', `
      return (async function() {
        ${toolCode}
      })();
    `);

    // Execute with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Tool execution timeout')), 10000);
    });

    const result = await Promise.race([
      executor(payload, context),
      timeoutPromise,
    ]);

    return result;
  } catch (error: any) {
    logger.error('Dynamic tool execution error:', error);
    return {
      success: false,
      error: `Tool execution failed: ${error?.message || 'Unknown error'}`,
    };
  }
}
