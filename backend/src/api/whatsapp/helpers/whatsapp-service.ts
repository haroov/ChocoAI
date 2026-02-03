/**
 * WhatsApp Service
 *
 * Handles WhatsApp Business API integration via Twilio.
 * Features: message sending, webhook processing, retry logic, command handling.
 */

import { logger } from '../../../utils/logger';

export interface WhatsAppMessage {
  from: string;
  text: string;
  timestamp: number;
  messageId?: string;
}

export interface WhatsAppResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  retryAttempts: number;
  retryDelay: number;
}

export class WhatsAppService {
  private config: WhatsAppConfig;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(config: Partial<WhatsAppConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Send a text message via WhatsApp using Twilio REST API
   */
  async sendMessage(to: string, message: string): Promise<WhatsAppResponse> {
    try {
      logger.info(`[TWILIO] Sending WhatsApp message to ${to}:`, message);

      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;

      const formData = new URLSearchParams();
      formData.append('To', `whatsapp:${to}`);
      formData.append('From', `whatsapp:${this.config.fromNumber}`);
      formData.append('Body', message);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${ Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Twilio API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      logger.info(`[TWILIO] Message sent successfully: ${(result as any).sid}`);

      return {
        success: true,
        messageId: (result as any).sid,
      };
    } catch (error) {
      logger.error('WhatsApp send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send message with retry logic
   */
  async sendMessageWithRetry(to: string, message: string): Promise<WhatsAppResponse> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      const result = await this.sendMessage(to, message);

      if (result.success) {
        return result;
      }

      lastError = result.error;

      if (attempt < this.config.retryAttempts) {
        logger.info(`WhatsApp send attempt ${attempt} failed, retrying in ${this.config.retryDelay}ms...`);
        await this.delay(this.config.retryDelay);
      }
    }

    return {
      success: false,
      error: `Failed after ${this.config.retryAttempts} attempts. Last error: ${lastError}`,
    };
  }

  /**
   * Process incoming webhook message
   */
  processWebhookMessage(body: any): WhatsAppMessage | null {
    try {
      // Twilio webhook format
      if (body.From && body.Body) {
        return {
          from: body.From.replace('whatsapp:', ''),
          text: body.Body,
          timestamp: Date.now(),
          messageId: body.MessageSid,
        };
      }

      // Direct API format (for testing)
      if (body.from && body.text) {
        return {
          from: body.from,
          text: body.text,
          timestamp: body.timestamp || Date.now(),
          messageId: body.messageId || crypto.randomUUID(),
        };
      }

      return null;
    } catch (error) {
      logger.error('Error processing webhook message:', error);
      return null;
    }
  }

  /**
   * Handle special commands (STOP, HELP, etc.)
   */
  handleCommand(message: WhatsAppMessage): string | null {
    const text = message.text.toLowerCase().trim();

    switch (text) {
      case 'stop':
        return 'You have been unsubscribed from ChocoAI messages. Reply START to resubscribe.';

      case 'start':
        return 'Welcome back to ChocoAI! I\'m here to help you get started with Choco. How can I assist you today?';

      case 'help':
        return `🤖 ChocoAI Help

I'm here to help you get started with Choco and complete your onboarding.

**Available commands:**
• HELP - Show this help message
• STOP - Unsubscribe from messages
• START - Resubscribe to messages

**What I can help with:**
• Registration process
• Account setup
• Getting started with Choco
• General questions about our platform

Just send me a message to get started! 🚀`;

      default:
        return null; // Not a command, process normally
    }
  }

  /**
   * Generate session ID for WhatsApp user
   */
  generateSessionId(phoneNumber: string): string {
    // Use phone number as part of session ID for consistency across turns
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    return `whatsapp-${cleanNumber}`;
  }

  /**
   * Validate phone number format
   */
  isValidPhoneNumber(phoneNumber: string): boolean {
    // Basic validation for international format
    const cleanNumber = phoneNumber.replace(/[^0-9+]/g, '');
    return cleanNumber.length >= 10 && cleanNumber.length <= 15;
  }

  /**
   * Format phone number for WhatsApp
   */
  formatPhoneNumber(phoneNumber: string): string {
    let cleanNumber = phoneNumber.replace(/[^0-9+]/g, '');

    // Add + if not present
    if (!cleanNumber.startsWith('+')) {
      cleanNumber = `+${ cleanNumber}`;
    }

    return cleanNumber;
  }

  /**
   * Utility: delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Default WhatsApp configuration
 */
export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  accountSid: (process.env as any).TWILIO_ACCOUNT_SID || '',
  authToken: (process.env as any).TWILIO_AUTH_TOKEN || '',
  fromNumber: (process.env as any).TWILIO_WHATSAPP_NUMBER || '',
  retryAttempts: 3,
  retryDelay: 1000,
};
