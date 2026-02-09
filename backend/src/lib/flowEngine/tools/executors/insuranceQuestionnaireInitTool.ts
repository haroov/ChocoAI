import { ToolExecutor, ToolResult } from '../types';

/**
 * insurance.questionnaire.init
 *
 * Legacy tool used by deprecated flows in `builtInFlows/_old`.
 * The active Clal SMB topic-split flows do NOT use this tool.
 *
 * We keep a stub to satisfy tool registry/typecheck/lint.
 */
export const insuranceQuestionnaireInitTool: ToolExecutor = async (): Promise<ToolResult> => ({
  success: false,
  error: 'insurance.questionnaire.init is not implemented in this build',
  errorCode: 'NOT_IMPLEMENTED',
});
