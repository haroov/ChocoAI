/**
 * WhatsApp Webhook Handler
 *
 * Handles incoming WhatsApp messages and integrates with the chat API.
 * Features: message processing, command handling, session management.
 */

import { Request, Response } from 'express';
import { flowEngine } from '../../../lib/flowEngine/flowEngine';
import { prisma } from '../../../core';
import { Secrets } from '../../../lib/__secrets';
import { logger } from '../../../utils/logger';
import { WhatsAppService, DEFAULT_WHATSAPP_CONFIG } from './whatsapp-service';
import { SessionManager, InMemorySessionStore } from './session-manager';
import { RequestContext } from './types';

interface WhatsAppHandlerConfig {
  whatsappService: WhatsAppService;
  sessionManager: SessionManager;
}

class WhatsAppHandler {
  private whatsappService: WhatsAppService;
  private sessionManager: SessionManager;

  constructor(config: WhatsAppHandlerConfig) {
    this.whatsappService = config.whatsappService;
    this.sessionManager = config.sessionManager;
  }

  /**
   * Load and update WhatsApp service configuration from Secrets
   */
  private async loadConfig(): Promise<void> {
    try {
      const accountSid = await Secrets.get('TWILIO_ACCOUNT_SID');
      const authToken = await Secrets.get('TWILIO_AUTH_TOKEN');
      const fromNumber = await Secrets.get('TWILIO_WHATSAPP_NUMBER');

      this.whatsappService.updateConfig({
        accountSid: accountSid || '',
        authToken: authToken || '',
        fromNumber: fromNumber || '',
      });
    } catch (error) {
      logger.error('Error loading WhatsApp config from Secrets:', error);
    }
  }

  /**
   * Handle incoming webhook from Twilio
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      // Load config from Secrets before processing
      await this.loadConfig();

      // Process the incoming message
      const message = this.whatsappService.processWebhookMessage(req.body);

      if (!message) {
        logger.warn('Invalid webhook message format');
        res.status(400).json({ error: 'Invalid message format' });
        return;
      }

      // Validate phone number
      if (!this.whatsappService.isValidPhoneNumber(message.from)) {
        logger.warn('Invalid phone number:', message.from);
        res.status(400).json({ error: 'Invalid phone number' });
        return;
      }

      // Format phone number
      const formattedNumber = this.whatsappService.formatPhoneNumber(
        message.from,
      );

      // Check for special commands first
      const commandResponse = this.whatsappService.handleCommand(message);
      if (commandResponse) {
        await this.sendResponse(formattedNumber, commandResponse);
        res.status(200).json({ status: 'command_handled' });
        return;
      }

      // Generate stable session ID for this user
      const sessionId = this.whatsappService.generateSessionId(formattedNumber);

      // Get or create session
      let session = await this.sessionManager.getSession(sessionId);
      if (!session) {
        const context: RequestContext = {
          requestId: crypto.randomUUID(),
          sessionId,
          channel: 'whatsapp',
          ip: 'unknown',
          userAgent: 'WhatsApp',
          timestamp: Date.now(),
        };
        session = await this.sessionManager.createSession(
          'whatsapp',
          context,
          sessionId,
        );
      }

      let conversationId = session.metadata?.conversationId as
        | string
        | undefined;
      if (!conversationId) {
        const conversation = await prisma.conversation.create({ data: { channel: 'whatsapp' } });
        conversationId = conversation.id;
        session.metadata.conversationId = conversationId;
        await this.sessionManager.saveSession(session);
      }

      await this.sessionManager.updateSessionActivity(sessionId);

      try {
        // const result = await processMessage({
        //   message: message.text,
        //   conversationId,
        //   channel: 'whatsapp',
        // });
        const processingRes = flowEngine.processMessage({
          conversationId,
          message: message.text,
          channel: 'whatsapp',
          stream: false,
        });

        let finalText = '';
        for await (const chunk of processingRes) {
          if (typeof chunk === 'string') finalText += chunk;
          else finalText = chunk.finalText;
        }
        await this.sendResponse(formattedNumber, finalText);

        res.status(200).json({
          status: 'processed',
          conversationId,
          // fields: result.fields,
        });
      } catch (processingError: any) {
        logger.error('WhatsApp processing error:', processingError);
        await this.sendResponse(
          formattedNumber,
          'Sorry, something went wrong while processing your message.',
        );
        res.status(500).json({ error: 'Processing failed' });
      }
    } catch (error) {
      logger.error('WhatsApp webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Split long WhatsApp messages into safe chunks
   */
  private chunkMessage(text: string, maxLength = 1500): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let index = 0;
    while (index < text.length) {
      chunks.push(text.slice(index, index + maxLength));
      index += maxLength;
    }
    return chunks;
  }

  /**
   * Send response to WhatsApp user
   */
  private async sendResponse(
    phoneNumber: string,
    message: string,
  ): Promise<void> {
    try {
      const result = await this.whatsappService.sendMessageWithRetry(
        phoneNumber,
        message,
      );

      if (!result.success) {
        logger.error('Failed to send WhatsApp response:', result.error);
      } else {
        logger.info('WhatsApp response sent successfully:', result.messageId);
      }
    } catch (error) {
      logger.error('Error sending WhatsApp response:', error);
    }
  }

  /**
   * Handle webhook verification (for Twilio)
   */
  handleVerification(req: Request, res: Response): void {
    const { challenge } = req.query;
    if (challenge) {
      res.status(200).send(challenge);
    } else {
      res.status(400).json({ error: 'Missing challenge parameter' });
    }
  }
  /**
   * Public method to send notifications from other services (e.g., Gateways)
   */
  public async sendNotification(phoneNumber: string, message: string): Promise<void> {
    await this.sendResponse(phoneNumber, message);
  }
}

const whatsappService = new WhatsAppService(DEFAULT_WHATSAPP_CONFIG);

// Create session manager (reuse existing session store)
const sessionStore = new InMemorySessionStore(30 * 60 * 1000); // 30 minutes
const sessionManager = new SessionManager(sessionStore, 50, 30 * 60 * 1000);

export const whatsappHandler = new WhatsAppHandler({
  whatsappService,
  sessionManager,
});
