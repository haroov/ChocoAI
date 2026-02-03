import { logger } from '../../../utils/logger';
import { SmsProvider } from './smsProvider';

/**
 * Twilio SMS provider implementation
 * Uses Twilio REST API for SMS (not WhatsApp)
 */
export class TwilioSmsProvider implements SmsProvider {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  async send(params: {
    to: string;
    body: string;
    from?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

      const formData = new URLSearchParams();
      formData.append('To', params.to); // SMS uses regular phone number, not whatsapp: prefix
      formData.append('From', params.from || this.fromNumber);
      formData.append('Body', params.body);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Twilio SMS API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      logger.info(`[TWILIO SMS] Message sent successfully: ${result.sid}`);

      return {
        success: true,
        messageId: result.sid,
      };
    } catch (error: any) {
      logger.error('Twilio SMS send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send with retry logic (exponential backoff)
   */
  async sendWithRetry(
    params: {
      to: string;
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
