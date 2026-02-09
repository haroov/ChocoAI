import { ToolExecutor, ToolResult } from '../types';

/**
 * insurance.saveIntake
 *
 * Legacy tool referenced by deprecated flows in `builtInFlows/_old`.
 * The active Clal SMB topic-split flows do NOT rely on this tool (they write intake via other routes).
 *
 * We keep a stub to satisfy tool registry/typecheck/lint.
 */
export const insuranceSaveIntakeTool: ToolExecutor = async (): Promise<ToolResult> => ({
  success: false,
  error: 'insurance.saveIntake is not implemented in this build',
  errorCode: 'NOT_IMPLEMENTED',
});
