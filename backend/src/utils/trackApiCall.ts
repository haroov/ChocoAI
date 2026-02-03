/**
 * API Call Tracker
 * Centralized wrapper for tracking all external API calls with logging
 */

import { prisma } from '../core/prisma';
import { logger } from './logger';

export interface ApiCallData {
  conversationId: string;
  provider: string; // 'CharidyAPI' | 'Mock' | 'LLM' | 'Webhook'
  operation: string; // 'signup' | 'verify' | 'extract_fields' | 'draft_reply'
  request: any;
  response?: any;
  status: 'ok' | 'error';
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
}

/**
 * Track API call with automatic latency measurement
 */
export async function trackApiCall<T>(
  conversationId: string,
  provider: string,
  operation: string,
  request: any,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();

  try {
    const response = await fn();
    const latencyMs = Date.now() - t0;

    // Extract token information for LLM calls
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let model: string | undefined;

    if (provider === 'LLM' && response && typeof response === 'object') {
      // Check if response has usage information (from LLM client)
      if ('usage' in response && response.usage && typeof response.usage === 'object') {
        const usage = response.usage as any;
        tokensIn = usage.promptTokens;
        tokensOut = usage.completionTokens;
      }
      // Check if response has model information
      if ('model' in response) {
        model = String(response.model);
      }
    }

    await logApiCall({
      conversationId,
      provider,
      operation,
      request,
      response,
      status: 'ok',
      latencyMs,
      tokensIn,
      tokensOut,
      model,
    });

    return response;
  } catch (error: any) {
    const latencyMs = Date.now() - t0;

    await logApiCall({
      conversationId,
      provider,
      operation,
      request,
      response: { error: error?.message || 'Unknown error' },
      status: 'error',
      latencyMs,
    });

    throw error;
  }
}

/**
 * Log API call to database
 */
export async function logApiCall(data: ApiCallData): Promise<void> {
  try {
    await prisma.apiCall.create({
      data: {
        conversationId: data.conversationId,
        provider: data.provider,
        operation: data.operation,
        request: data.request,
        response: data.response,
        statusText: data.status,
        latencyMs: data.latencyMs,
        tokensIn: data.tokensIn,
        tokensOut: data.tokensOut,
        model: data.model,
      },
    });
  } catch (error) {
    logger.error('Failed to log API call:', error);
  }
}

/**
 * Track flow engine events (field collection, stage transitions, etc.)
 * These events are logged to the apiCall table with provider='FlowEngine' for visibility in conversation details
 */
export async function trackFlowEvent(
  conversationId: string,
  eventType: 'field-collection' | 'field-parsing-failure' | 'stage-transition' | 'stage-completion-check',
  data: {
    stage?: string;
    field?: string;
    value?: any;
    error?: string;
    missingFields?: string[];
    isComplete?: boolean;
    reason?: string;
    rawValue?: string;
    parsedValue?: string;
  },
): Promise<void> {
  try {
    await logApiCall({
      conversationId,
      provider: 'FlowEngine',
      operation: eventType,
      request: data,
      response: { success: true },
      status: 'ok',
    });
  } catch (error) {
    // Silently fail - flow tracking is non-critical
    logger.error('Failed to track flow event:', error);
  }
}
