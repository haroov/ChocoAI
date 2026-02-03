import { prisma } from '../../core/prisma';
import { registerRoute } from '../../utils/routesRegistry';
import { logger } from '../../utils/logger';
import { meshulamEmailHandler } from '../../lib/services/gateways/meshulamEmailHandler';

registerRoute('post', '/api/webhooks/mailgun', async (req, res) => {
  try {
    const { body } = req;

    // Basic logging of incoming webhook
    logger.info('[MailgunWebhook] Received webhook', {
      sender: body.sender,
      subject: body.subject,
      recipient: body.recipient,
    });

    // Mailgun verification (Token/Signature)
    // To implement strictly: use body.signature.timestamp and body.signature.token with api key.
    // For MVP/Demo: skipping strict crypto verification but highly recommended for prod.

    // Extract content
    // Mailgun sends 'stripped-text' or 'body-plain'
    const subject = body.subject || '';
    const content = body['body-plain'] || body['stripped-text'] || '';

    // Dispatcher logic
    // Add more handlers here as needed
    if (/meshulam|grow/i.test(subject) || /meshulam|grow/i.test(body.sender)) {
      logger.info('[MailgunWebhook] Detected Meshulam email, invoking handler');

      const credentials = await meshulamEmailHandler.parseEmail(subject, content);

      if (credentials) {
        const success = await meshulamEmailHandler.processCredentials(credentials);
        if (success) {
          logger.info('[MailgunWebhook] Successfully processed Meshulam email');
        } else {
          logger.warn('[MailgunWebhook] Failed to update gateway from email');
        }
      } else {
        logger.info('[MailgunWebhook] Parsed email but found no credentials');
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('[MailgunWebhook] Error processing webhook', error);
    res.status(500).send('Internal Server Error');
  }
});
