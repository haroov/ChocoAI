import { prisma } from '../../core/prisma';
import { logger } from '../../utils/logger';

/**
 * Flow Tracer - logs detailed flow progression for debugging and observability
 */
class FlowTracer {
  /**
   * Trace stage entry
   * Returns traceId for subsequent operations
   */
  async traceStageEntry(
    conversationId: string,
    flowSlug: string,
    stageSlug: string,
    userData: Record<string, unknown>,
  ): Promise<string> {
    try {
      const trace = await prisma.flowTrace.create({
        data: {
          conversationId,
          flowSlug,
          stageSlug,
          enteredAt: new Date(),
          fieldsCollected: [],
          toolsExecuted: [],
          errorsEncountered: [],
          userDataSnapshot: userData as any,
        },
      });

      return trace.id;
    } catch (error: any) {
      logger.error('Error tracing stage entry:', error);
      // Don't throw - tracing should not break the flow
      return '';
    }
  }

  /**
   * Trace tool execution
   */
  async traceToolExecution(
    traceId: string,
    toolName: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    if (!traceId) return;

    try {
      const trace = await prisma.flowTrace.findUnique({
        where: { id: traceId },
      });

      if (!trace) {
        logger.warn('Trace not found for tool execution:', traceId);
        return;
      }

      const toolsExecuted = (trace.toolsExecuted as any[]) || [];
      toolsExecuted.push({
        toolName,
        success,
        error,
        timestamp: new Date().toISOString(),
      });

      await prisma.flowTrace.update({
        where: { id: traceId },
        data: { toolsExecuted: toolsExecuted as any },
      });
    } catch (error: any) {
      logger.error('Error tracing tool execution:', error);
      // Don't throw - tracing should not break the flow
    }
  }

  /**
   * Trace stage completion
   */
  async traceStageCompletion(
    traceId: string,
    fieldsCollected: string[],
  ): Promise<void> {
    if (!traceId) return;

    try {
      await prisma.flowTrace.update({
        where: { id: traceId },
        data: {
          completedAt: new Date(),
          fieldsCollected,
        },
      });
    } catch (error: any) {
      logger.error('Error tracing stage completion:', error);
      // Don't throw - tracing should not break the flow
    }
  }

  /**
   * Trace error
   */
  async traceError(
    traceId: string,
    error: string,
    stage: string,
    toolName?: string,
    errorCode?: string,
  ): Promise<void> {
    if (!traceId) return;

    try {
      const trace = await prisma.flowTrace.findUnique({
        where: { id: traceId },
      });

      if (!trace) {
        logger.warn('Trace not found for error:', traceId);
        return;
      }

      const errorsEncountered = (trace.errorsEncountered as any[]) || [];
      errorsEncountered.push({
        error,
        errorCode,
        stage,
        toolName,
        timestamp: new Date().toISOString(),
      });

      await prisma.flowTrace.update({
        where: { id: traceId },
        data: { errorsEncountered: errorsEncountered as any },
      });
    } catch (error: any) {
      logger.error('Error tracing error:', error);
      // Don't throw - tracing should not break the flow
    }
  }

  /**
   * Get flow trace for a conversation
   */
  async getConversationTrace(conversationId: string) {
    try {
      return await prisma.flowTrace.findMany({
        where: { conversationId },
        orderBy: { enteredAt: 'asc' },
      });
    } catch (error: any) {
      logger.error('Error getting conversation trace:', error);
      return [];
    }
  }

  /**
   * Get stuck flows (same stage for >X minutes)
   */
  async getStuckFlows(minutes: number = 30) {
    try {
      const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);

      return await prisma.flowTrace.findMany({
        where: {
          enteredAt: {
            lt: cutoffTime,
          },
          completedAt: null,
        },
        include: {
          conversation: {
            select: {
              id: true,
              userId: true,
              channel: true,
            },
          },
        },
        orderBy: { enteredAt: 'asc' },
      });
    } catch (error: any) {
      logger.error('Error getting stuck flows:', error);
      return [];
    }
  }

  /**
   * Get error frequency by stage/tool
   */
  async getErrorFrequency() {
    try {
      // Get all traces and filter in code (Prisma doesn't support array length checks)
      const traces = await prisma.flowTrace.findMany({
        select: {
          flowSlug: true,
          stageSlug: true,
          errorsEncountered: true,
        },
      });

      const errorCounts: Record<string, { stage: string; tool?: string; count: number }> = {};

      traces.forEach((trace) => {
        const errors = (trace.errorsEncountered as any[]) || [];
        errors.forEach((error) => {
          const key = `${trace.flowSlug}:${trace.stageSlug}:${error.toolName || 'unknown'}`;
          if (!errorCounts[key]) {
            errorCounts[key] = {
              stage: trace.stageSlug,
              tool: error.toolName,
              count: 0,
            };
          }
          errorCounts[key].count++;
        });
      });

      return Object.values(errorCounts).sort((a, b) => b.count - a.count);
    } catch (error: any) {
      logger.error('Error getting error frequency:', error);
      return [];
    }
  }
}

export const flowTracer = new FlowTracer();
