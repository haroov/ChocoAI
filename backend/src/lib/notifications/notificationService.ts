import { prisma } from '../../core/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../core/config';
import { getTemplate, replaceTemplateVariables } from './templates';
import { SendGridProvider } from './providers/sendgridProvider';
import { TwilioSmsProvider } from './providers/twilioSmsProvider';

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface NotificationOptions {
  requestId?: string;
  idempotencyKey?: string;
}

/**
 * Notification Service - unified interface for email and SMS
 */
class NotificationService {
  private emailProvider: SendGridProvider;
  private smsProvider: TwilioSmsProvider | null;

  constructor() {
    this.emailProvider = new SendGridProvider();

    // Initialize SMS provider if Twilio credentials are available
    // For now, SMS provider requires explicit configuration
    // In production, these would come from config
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioSmsNumber = process.env.TWILIO_SMS_NUMBER;

    if (twilioAccountSid && twilioAuthToken && twilioSmsNumber) {
      this.smsProvider = new TwilioSmsProvider(twilioAccountSid, twilioAuthToken, twilioSmsNumber);
    } else {
      this.smsProvider = null;
      logger.warn('Twilio SMS credentials not configured, SMS sending will be disabled');
    }
  }

  /**
   * Send email using a template
   */
  async sendEmail(
    to: string,
    templateId: string,
    data: Record<string, unknown>,
    options?: NotificationOptions,
  ): Promise<NotificationResult> {
    try {
      // Check idempotency
      if (options?.idempotencyKey) {
        const existing = await prisma.notificationLog.findFirst({
          where: {
            conversationId: options.requestId || '',
            idempotencyKey: options.idempotencyKey,
            channel: 'email',
            success: true,
          },
        });

        if (existing) {
          logger.info('Email already sent (idempotency check)', {
            idempotencyKey: options.idempotencyKey,
            to,
          });
          return {
            success: true,
            messageId: existing.messageId || undefined,
          };
        }
      }

      // Detect language from data or default to english
      const language = (data.language as 'hebrew' | 'english') || 'english';
      const template = getTemplate(templateId, language);

      if (!template) {
        return {
          success: false,
          error: `Template not found: ${templateId}`,
        };
      }

      if (template.channel !== 'email') {
        return {
          success: false,
          error: `Template ${templateId} is not an email template`,
        };
      }

      // Replace template variables
      const subject = template.subject ? replaceTemplateVariables(template.subject, data) : '';
      const body = replaceTemplateVariables(template.body, data);

      // Send email
      const result = await this.emailProvider.sendWithRetry({
        to,
        subject,
        body,
      });

      // Log notification
      await this.logNotification({
        conversationId: options?.requestId || '',
        channel: 'email',
        templateId,
        to,
        success: result.success,
        messageId: result.messageId,
        error: result.error,
        idempotencyKey: options?.idempotencyKey,
      });

      return result;
    } catch (error: any) {
      logger.error('Error sending email:', error);
      return {
        success: false,
        error: error?.message || 'Failed to send email',
      };
    }
  }

  /**
   * Send Gateway Approved Email
   */
  async sendGatewayApprovedEmail(
    to: string,
    data: { firstName: string; workspaceName: string; dashboardUrl: string },
    options?: NotificationOptions,
  ): Promise<NotificationResult> {
    // We'll use a hardcoded template ID or handle it dynamically
    // For now, let's use a generic 'gateway_approved' template ID
    // that the template engine should resolve.
    return this.sendEmail(
      to,
      'gateway_approved',
      { ...data, language: 'en' }, // Default to English or pass in data
      options,
    );
  }

  /**
   * Send SMS using a template
   */
  async sendSms(
    to: string,
    templateId: string,
    data: Record<string, unknown>,
    options?: NotificationOptions,
  ): Promise<NotificationResult> {
    try {
      if (!this.smsProvider) {
        return {
          success: false,
          error: 'SMS provider not configured',
        };
      }

      // Check idempotency
      if (options?.idempotencyKey) {
        const existing = await prisma.notificationLog.findFirst({
          where: {
            conversationId: options.requestId || '',
            idempotencyKey: options.idempotencyKey,
            channel: 'sms',
            success: true,
          },
        });

        if (existing) {
          logger.info('SMS already sent (idempotency check)', {
            idempotencyKey: options.idempotencyKey,
            to,
          });
          return {
            success: true,
            messageId: existing.messageId || undefined,
          };
        }
      }

      // Detect language from data or default to english
      const language = (data.language as 'hebrew' | 'english') || 'english';
      const template = getTemplate(templateId, language);

      if (!template) {
        return {
          success: false,
          error: `Template not found: ${templateId}`,
        };
      }

      if (template.channel !== 'sms') {
        return {
          success: false,
          error: `Template ${templateId} is not an SMS template`,
        };
      }

      // Replace template variables
      const body = replaceTemplateVariables(template.body, data);

      // Send SMS
      const result = await this.smsProvider.sendWithRetry({
        to,
        body,
      });

      // Log notification
      await this.logNotification({
        conversationId: options?.requestId || '',
        channel: 'sms',
        templateId,
        to,
        success: result.success,
        messageId: result.messageId,
        error: result.error,
        idempotencyKey: options?.idempotencyKey,
      });

      return result;
    } catch (error: any) {
      logger.error('Error sending SMS:', error);
      return {
        success: false,
        error: error?.message || 'Failed to send SMS',
      };
    }
  }

  /**
   * Send via multiple channels
   */
  async sendMultiChannel(
    channels: { email?: string; sms?: string },
    templateId: string,
    data: Record<string, unknown>,
    options?: NotificationOptions,
  ): Promise<{ email?: NotificationResult; sms?: NotificationResult }> {
    const results: { email?: NotificationResult; sms?: NotificationResult } = {};

    if (channels.email) {
      results.email = await this.sendEmail(channels.email, templateId, data, options);
    }

    if (channels.sms) {
      results.sms = await this.sendSms(channels.sms, templateId, data, options);
    }

    return results;
  }

  /**
   * Log notification attempt
   */
  async logNotification(params: {
    conversationId: string;
    channel: 'email' | 'sms';
    templateId: string;
    to: string;
    success: boolean;
    messageId?: string;
    error?: string;
    idempotencyKey?: string;
  }): Promise<void> {
    try {
      await prisma.notificationLog.create({
        data: {
          conversationId: params.conversationId,
          channel: params.channel,
          templateId: params.templateId,
          to: params.to,
          success: params.success,
          messageId: params.messageId,
          error: params.error,
          provider: params.channel === 'email' ? 'sendgrid' : 'twilio',
          idempotencyKey: params.idempotencyKey,
        },
      });
    } catch (error: any) {
      // Don't throw - logging should not break the flow
      logger.error('Error logging notification:', error);
    }
  }
}

export const notificationService = new NotificationService();
