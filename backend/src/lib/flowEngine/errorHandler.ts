import { prisma } from '../../core/prisma';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { sendTechSupportEmail, gatherErrorDetails } from '../../utils/emailService';
import { llmService } from './llmService';
import { ErrorHandlingConfig } from './types';
import { flowHelpers } from './flowHelpers';

export type ErrorContext = {
  toolName?: string;
  stage?: string;
  stageDescription?: string;
  httpStatus?: number;
  conversationId: string;
  messageId: string;
  userMessage?: string;
};

export type ErrorAnalysis = {
  isTechnical: boolean;
  message: string;
};

class ErrorHandler {
  /**
   * Analyzes an error and determines if it's technical or user-actionable
   */
  analyzeError(rawError: string): ErrorAnalysis {
    const isTechnical = this.isTechnicalError(rawError);
    return {
      isTechnical,
      message: rawError,
    };
  }

  /**
   * Generates a user-friendly error message using LLM to intelligently interpret the error.
   * The LLM decides how to communicate based on error type:
   * - User-actionable: Clear explanation with actionable suggestions
   * - User-non-actionable: Generic, reassuring message (don't expose details user can't fix)
   * - Technical: Generic, non-scary message that maintains sense of control
   */
  async generateErrorMessage(
    rawError: string,
    context: ErrorContext,
  ): Promise<string> {
    // FORCE DEBUG: Return raw error immediately
    return `DEBUG RAW ERROR: ${rawError} | STAGE: ${context.stage}`;
    try {
      try {
        const debugPath = path.join(process.cwd(), 'debug_error.log');
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] Error in stage ${context.stage}: ${rawError}\nStack: ${new Error().stack}\n\n`;
        fs.appendFileSync(debugPath, logEntry);
      } catch (e) { console.error('Failed to write debug log', e); }

      // Detect conversation language
      const conversationLanguage = await this.detectConversationLanguage(context.conversationId);

      // Get conversation context
      const conversation = await prisma.conversation.findUnique({
        where: { id: context.conversationId },
        select: { channel: true },
      });

      // Get recent conversation history for context (last 10 messages)
      const recentMessages = await prisma.message.findMany({
        where: { conversationId: context.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { role: true, content: true },
      });

      const languageInstruction = conversationLanguage === 'hebrew'
        ? 'CRITICAL: The user is communicating in Hebrew. You MUST respond ONLY in Hebrew throughout this entire conversation. Never switch to English, even for technical terms or links. Maintain Hebrew language consistency at all times.'
        : conversationLanguage === 'english'
          ? 'CRITICAL: The user is communicating in English. You MUST respond ONLY in English throughout this entire conversation. Maintain English language consistency at all times.'
          : '';

      // First, check if this is a technical error that should be completely masked
      if (this.isTechnicalError(rawError)) {
        // For technical errors, return a generic message immediately without using LLM
        // This ensures no technical details can leak through
        // TEMPORARY DEBUGGING: Expose error
        return conversationLanguage === 'hebrew'
          ? `נתקלנו בבעיה זמנית: ${rawError}`
          : `Temporary issue: ${rawError}`;
      }

      // Build system prompt for error interpretation
      const systemPrompt = [
        'You are an intelligent error communication assistant for Choco Expert Agent.',
        'Your role is to analyze errors and communicate them to users in a way that maintains professionalism and a sense of control.',
        '',
        'ERROR COMMUNICATION RULES:',
        '',
        '1. USER-ACTIONABLE ERRORS (user can fix):',
        '   - Examples: "email already exists", "invalid email format", "missing required field", "user already registered", "phone number invalid", "phone number required"',
        '   - Action: Explain clearly what the issue is and provide actionable suggestions',
        '   - Tone: Helpful, clear, solution-oriented',
        '   - For missing fields: Gently ask for the missing information without making the user feel bad',
        '   - For invalid fields: Explain what was wrong and ask them to provide the correct information',
        '   - Example (missing field): "I need your phone number to complete the registration. Could you please provide it?"',
        '   - Example (invalid field): "It looks like this email is already registered. Would you like to sign in instead, or try registering with a different email address?"',
        '   - Example (validation error): "The phone number format seems incorrect. Please provide it in international format (e.g., +972501234567) or local format (e.g., 0501234567)."',
        '',
        '2. USER-NON-ACTIONABLE ERRORS (user cannot fix but it\'s relevant):',
        '   - Examples: "user already registered", "account exists", "duplicate registration"',
        '   - Action: Provide a generic, reassuring message without exposing technical details',
        '   - Tone: Professional, reassuring, maintain sense of control',
        '   - Example: "It appears this account may already exist. Would you like to try signing in, or contact support for assistance?"',
        '',
        '3. TECHNICAL ERRORS (system/internal issues - MUST BE MASKED):',
        '   - Examples: webhook errors, HTTPS/protocol errors, API endpoint errors, server configuration errors, network timeouts, connection issues, HTTP status codes, technical protocols',
        '   - Action: ALWAYS provide a generic, non-scary message. NEVER mention technical terms like "webhook", "HTTPS", "protocol", "API", "endpoint", "server", "configuration"',
        '   - Tone: Calm, professional, reassuring',
        '   - Example: "We encountered a temporary issue while processing your request. Please try again in a moment. If the problem persists, feel free to contact support."',
        '   - NEVER expose: Technical error codes, stack traces, internal system details, API endpoint names, webhook URLs, protocols (HTTP/HTTPS), server configurations, technical implementation details',
        '   - CRITICAL: If the error mentions webhook, HTTPS, protocol, API endpoint, server configuration, or any technical infrastructure - treat it as a technical error and mask it completely',
        '',
        'CRITICAL GUIDELINES:',
        '- Always maintain a sense of control and professionalism',
        '- Never expose raw technical error messages to users',
        '- Never use scary language like "error", "failed", "broken" - use softer terms like "issue", "temporary problem"',
        '- If user can do something about it, provide clear, actionable suggestions',
        '- If user cannot fix it OR it is a technical/system issue, keep it generic and reassuring',
        '- For technical errors, ALWAYS mask completely - never mention technical terms',
        '- Keep messages concise and helpful - MAXIMUM 1-2 sentences. Be brief.',
        '',
        `Current stage: ${context.stageDescription || context.stage || 'unknown'}`,
        `Tool that caused error: ${context.toolName || 'unknown'}`,
        context.httpStatus ? `HTTP Status: ${context.httpStatus}` : '',
        '',
        languageInstruction,
      ].filter(Boolean).join('\n');

      // Build user message for LLM
      const userMessage = [
        'Analyze the following error and generate an appropriate user-facing message:',
        '',
        `Error: ${rawError}`,
        '',
        context.userMessage ? `User's original message: ${context.userMessage}` : '',
        '',
        'Recent conversation context:',
        recentMessages.reverse().map((msg) => `${msg.role}: ${msg.content}`).join('\n'),
        '',
        'Generate a user-friendly message that follows the rules above. The message should:',
        '- Be in the same language as the conversation',
        '- Be BRIEF - maximum 1-2 sentences',
        '- Maintain professionalism and sense of control',
        '- Be appropriate for the error type (actionable, non-actionable, or technical)',
        '- Provide helpful suggestions when applicable',
        '- NEVER expose technical details - if you see words like "webhook", "HTTPS", "protocol", "API", "endpoint", "server", treat it as a technical error and provide ONLY a generic, reassuring message',
        '- If the error is technical, do NOT explain what went wrong - just provide a generic message about trying again',
        '- CRITICAL: Keep it short. No "סליחה" (sorry) or long apologies. Just state the issue and action. Example: "נתקלנו בבעיה. נסה שוב." or "Issue occurred. Please try again."',
      ].filter(Boolean).join('\n');

      // Use LLM to generate error message
      const errorMessage = await this.generateErrorMessageWithLLM(
        context.conversationId,
        context.messageId,
        systemPrompt,
        userMessage,
        conversationLanguage === 'hebrew',
      );

      return errorMessage;
    } catch (error: any) {
      logger.error('Error generating error message:', error);
      // Fallback to generic message in appropriate language
      const conversationLanguage = await this.detectConversationLanguage(context.conversationId);
      return conversationLanguage === 'hebrew'
        ? 'נתקלנו בבעיה זמנית. נסה שוב בעוד רגע.'
        : 'Temporary issue. Please try again in a moment.';
    }
  }

  /**
   * Uses LLM to generate error message with streaming support
   */
  private async generateErrorMessageWithLLM(
    conversationId: string,
    messageId: string,
    systemPrompt: string,
    userMessage: string,
    isHebrew: boolean,
  ): Promise<string> {
    // Create a temporary message ID for error generation
    const tempMessageId = messageId || `error-${Date.now()}`;

    // Use non-streaming for error messages to get complete response
    const responseGenerator = llmService.generateResponse({
      conversationId,
      messageId: tempMessageId,
      message: userMessage,
      stream: false,
      systemPrompt,
    });

    let errorMessage = '';
    for await (const chunk of responseGenerator) {
      errorMessage += chunk;
    }

    return errorMessage.trim() || (isHebrew
      ? 'נתקלנו בבעיה. נסה שוב.'
      : 'Issue occurred. Please try again.');
  }

  /**
   * Detects if an error is a technical/system error that should be completely masked from users
   */
  private isTechnicalError(error: string): boolean {
    const technicalIndicators = [
      // English technical terms
      'webhook',
      'https',
      'http',
      'protocol',
      'endpoint',
      'api endpoint',
      'server configuration',
      'server error',
      'internal server',
      'connection timeout',
      'network error',
      'socket',
      'tls',
      'ssl',
      'certificate',
      'dns',
      // Avoid matching generic business terms like "payment gateway".
      // Keep only protocol/status variants.
      'bad gateway',
      'gateway timeout',
      'proxy',
      'cors',
      'authentication token',
      'authorization header',
      'request header',
      'response header',
      'status code',
      'http status',
      '500',
      '502',
      '503',
      '504',
      'database connection',
      'sql',
      'query failed',
      'migration',
      'schema',
      'constraint',
      'foreign key',
      'unique constraint',
      'stack trace',
      'exception',
      'error code',
      'error id',
      'trace id',
      'request id',
      'log',
      'debug',
      'environment variable',
      'config',
      'configuration',
      // Hebrew technical terms (common translations)
      'וובחוק', // webhook (transliterated)
      'פרוטוקול', // protocol
      'שרת', // server
      'תצורת שרת', // server configuration
      'שגיאת שרת', // server error
      'חיבור', // connection
      'רשת', // network
      'תעודת', // certificate
      'אימות', // authentication
      'הרשאה', // authorization
      'כותרת', // header
      'קוד סטטוס', // status code
      'בסיס נתונים', // database
      'שאילתה', // query
      'סכמה', // schema
      'אילוץ', // constraint
      'מפתח זר', // foreign key
      'מפתח ייחודי', // unique constraint
      'קוד שגיאה', // error code
      'משתנה סביבה', // environment variable
      'תצורה', // configuration
    ];

    const lowerError = error.toLowerCase();
    return technicalIndicators.some((indicator) => lowerError.includes(indicator));
  }

  /**
   * Detects conversation language based on user messages
   */
  private async detectConversationLanguage(conversationId: string): Promise<'hebrew' | 'english' | null> {
    const messages = await prisma.message.findMany({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { content: true },
    });

    if (messages.length === 0) return null;

    // Check if any user message contains Hebrew characters
    const hasHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));
    return hasHebrew ? 'hebrew' : 'english';
  }

  /**
   * Handles technical errors with configurable flow behavior
   * Supports pause, newStage, continue, and endFlow behaviors
   */
  async handleTechnicalError(
    error: string,
    context: ErrorContext & { flowId?: string; flowSlug?: string },
    errorConfig: ErrorHandlingConfig,
  ): Promise<{
    behavior: 'pause' | 'newStage' | 'continue' | 'endFlow';
    nextStage?: string;
    userMessage: string;
  }> {
    const { conversationId, stage, flowId, flowSlug, toolName, httpStatus } = context;

    // Send email notification asynchronously
    if (errorConfig) {
      const errorDetails = await gatherErrorDetails(
        conversationId,
        error,
        httpStatus,
        stage,
        flowSlug,
        toolName,
      );

      sendTechSupportEmail(errorDetails, {
        emailTo: errorConfig.emailTo,
        emailSubject: errorConfig.emailSubject,
        includeDetails: errorConfig.includeDetails,
      });
    }

    // Generate user message (use custom message if provided, otherwise generate one)
    let userMessage: string;
    if (errorConfig.message) {
      // Replace template variables in custom message
      userMessage = errorConfig.message
        .replace('{error}', error.substring(0, 50))
        .replace('{stage}', stage || 'unknown')
        .replace('{conversationId}', conversationId);
    } else {
      // Generate default message based on conversation language
      const conversationLanguage = await this.detectConversationLanguage(conversationId);
      if (conversationLanguage === 'hebrew') {
        userMessage = 'נראה שיש בעיה טכנית עם CharidyAPI. שלחתי הודעה לצוות הטכני ואעדכן אותך ברגע שנפתור את הבעיה.';
      } else {
        userMessage = 'We were trying to log you in using CharidyAPI, however it looks like they have technical issues. I\'ve emailed their tech support and I\'ll let you know as soon as I solve the issue.';
      }
    }

    // Return behavior and next stage
    return {
      behavior: errorConfig.behavior,
      nextStage: errorConfig.behavior === 'newStage' ? errorConfig.nextStage : undefined,
      userMessage,
    };
  }
}

export const errorHandler = new ErrorHandler();
