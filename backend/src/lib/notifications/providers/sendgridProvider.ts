import sgMail from '@sendgrid/mail';
import { config } from '../../../core/config';
import { logger } from '../../../utils/logger';
import { EmailProvider } from './emailProvider';

/**
 * SendGrid email provider implementation
 */
export class SendGridProvider implements EmailProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = config.email.sendgridApiKey || '';
    if (this.apiKey) {
      sgMail.setApiKey(this.apiKey);
    }
  }

  async send(params: {
    to: string;
    subject: string;
    body: string;
    from?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'SendGrid API key not configured',
      };
    }

    try {
      const msg = {
        to: params.to,
        from: params.from || 'noreply@chocoinsurance.com',
        subject: params.subject,
        text: params.body,
        html: params.body.replace(/\n/g, '<br>'),
      };

      const response = await sgMail.send(msg);
      const messageId = response[0]?.headers?.['x-message-id'] || undefined;

      return {
        success: true,
        messageId,
      };
    } catch (error: any) {
      logger.error('SendGrid email send error:', error);
      return {
        success: false,
        error: error?.message || 'Failed to send email',
      };
    }
  }

  /**
   * Send with retry logic (exponential backoff)
   */
  async sendWithRetry(
    params: {
      to: string;
      subject: string;
      body: string;
      from?: string;
    },
    maxRetries: number = 3,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await this.send(params);

      if (result.success) {
        return result;
      }

      lastError = result.error;

      // Exponential backoff: wait 2^attempt seconds
      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return {
      success: false,
      error: lastError || 'Failed after retries',
    };
  }
}
