import { ToolExecutor } from '../types';
import { flowHandoffTool } from './flowHandoffTool';

/**
 * Handoff to Login Tool
 *
 * hardcodes targetFlowSlug to 'login' and delegates to flowHandoffTool.
 */
export const handoffToLoginTool: ToolExecutor = async (payload, context) => flowHandoffTool({ ...payload, targetFlowSlug: 'login' }, context);
