/**
 * Email Service for sending technical error notifications
 * Uses SendGrid API for email delivery
 */

import sgMail from '@sendgrid/mail';
import { config } from '../core/config';
import { prisma } from '../core/prisma';
import { flowHelpers } from '../lib/flowEngine/flowHelpers';
import { logger } from './logger';

export interface TechSupportEmailDetails {
  error: string;
  statusCode?: number;
  conversationId: string;
  userId?: string;
  stage?: string;
  flow?: string;
  toolName?: string;
  timestamp: string;
  apiRequest?: any;
  apiResponse?: any;
  userData?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string; createdAt: Date }>;
}

export interface EmailConfig {
  emailTo?: string;
  emailSubject?: string;
  includeDetails?: boolean;
}

/**
 * Send technical error notification email to tech support
 * This function runs asynchronously (fire and forget) to not block the flow
 */
export async function sendTechSupportEmail(
  errorDetails: TechSupportEmailDetails,
  emailConfig: EmailConfig,
): Promise<void> {
  // Run asynchronously - don't block the flow
  setImmediate(async () => {
    try {
      const { sendgridApiKey } = config.email;
      if (!sendgridApiKey) {
        logger.warn('SENDGRID_API_KEY not configured, skipping email notification', {
          conversationId: errorDetails.conversationId,
        });
        return;
      }

      sgMail.setApiKey(sendgridApiKey);

      const recipientEmail = emailConfig.emailTo || config.email.techSupportEmail;
      const includeDetails = emailConfig.includeDetails !== false; // Default to true

      // Build email subject
      const subject = emailConfig.emailSubject
        ? emailConfig.emailSubject
          .replace('{error}', errorDetails.error.substring(0, 50))
          .replace('{stage}', errorDetails.stage || 'unknown')
          .replace('{conversationId}', errorDetails.conversationId)
        : `[ChocoAI] Technical Error - ${errorDetails.error.substring(0, 50)}`;

      // Build email body
      let emailBody = 'Technical Error Notification\n\n';
      emailBody += `Error: ${errorDetails.error}\n`;
      if (errorDetails.statusCode) {
        emailBody += `Status Code: ${errorDetails.statusCode}\n`;
      }
      emailBody += `Conversation ID: ${errorDetails.conversationId}\n`;
      if (errorDetails.userId) {
        emailBody += `User ID: ${errorDetails.userId}\n`;
      }
      emailBody += `Stage: ${errorDetails.stage || 'unknown'}\n`;
      emailBody += `Flow: ${errorDetails.flow || 'unknown'}\n`;
      if (errorDetails.toolName) {
        emailBody += `Tool: ${errorDetails.toolName}\n`;
      }
      emailBody += `Timestamp: ${errorDetails.timestamp}\n\n`;

      if (includeDetails) {
        emailBody += '=== DETAILED INFORMATION ===\n\n';

        // API Request/Response
        if (errorDetails.apiRequest || errorDetails.apiResponse) {
          emailBody += '--- API Call Details ---\n';
          if (errorDetails.apiRequest) {
            emailBody += `Request: ${JSON.stringify(errorDetails.apiRequest, null, 2)}\n\n`;
          }
          if (errorDetails.apiResponse) {
            emailBody += `Response: ${JSON.stringify(errorDetails.apiResponse, null, 2)}\n\n`;
          }
        }

        // User Data
        if (errorDetails.userData && Object.keys(errorDetails.userData).length > 0) {
          emailBody += '--- User Data ---\n';
          emailBody += `${JSON.stringify(errorDetails.userData, null, 2)}\n\n`;
        }

        // Conversation History
        if (errorDetails.conversationHistory && errorDetails.conversationHistory.length > 0) {
          emailBody += `--- Conversation History (last ${errorDetails.conversationHistory.length} messages) ---\n`;
          errorDetails.conversationHistory.forEach((msg, idx) => {
            emailBody += `[${msg.role}] ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`;
            emailBody += `  Time: ${msg.createdAt.toISOString()}\n\n`;
          });
        }
      }

      const msg = {
        to: recipientEmail,
        from: 'noreply@chocoinsurance.com', // TODO: Configure from email in config
        subject,
        text: emailBody,
        html: emailBody.replace(/\n/g, '<br>'),
      };

      await sgMail.send(msg);
      logger.info('Tech support email sent successfully', {
        conversationId: errorDetails.conversationId,
        recipientEmail,
      });
    } catch (error: any) {
      // Silently fail - email sending should not break the flow
      logger.error('Failed to send tech support email', {
        error: error?.message,
        conversationId: errorDetails.conversationId,
      });
    }
  });
}

/**
 * Gather detailed error information for email notification
 */
export async function gatherErrorDetails(
  conversationId: string,
  error: string,
  statusCode?: number,
  stage?: string,
  flow?: string,
  toolName?: string,
): Promise<TechSupportEmailDetails> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    let userData: Record<string, unknown> = {};
    let flowId: string | undefined;

    if (conversation?.userId) {
      // Get flowId from UserFlow
      const userFlow = await prisma.userFlow.findUnique({
        where: { userId: conversation.userId },
        select: { flowId: true },
      });

      if (userFlow?.flowId) {
        flowId = userFlow.flowId;
        userData = await flowHelpers.getUserData(conversation.userId, flowId);
      }
    }

    // Get latest API call for this conversation (the one that failed)
    const latestApiCall = await prisma.apiCall.findFirst({
      where: {
        conversationId,
        operation: toolName || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    // Get conversation history (last 10 messages)
    const conversationHistory = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return {
      error,
      statusCode,
      conversationId,
      userId: conversation?.userId || undefined,
      stage,
      flow,
      toolName,
      timestamp: new Date().toISOString(),
      apiRequest: latestApiCall?.request || undefined,
      apiResponse: latestApiCall?.response || undefined,
      userData: Object.keys(userData).length > 0 ? userData : undefined,
      conversationHistory: conversationHistory.reverse(), // Reverse to show chronological order
    };
  } catch (error: any) {
    logger.error('Failed to gather error details for email', {
      error: error?.message,
      conversationId,
    });
    // Return minimal details if gathering fails
    return {
      error,
      statusCode,
      conversationId,
      stage,
      flow,
      toolName,
      timestamp: new Date().toISOString(),
    };
  }
}
