import { Secrets } from '../../lib/__secrets';
import { registerRoute } from '../../utils/routesRegistry';
import { whatsappHandler } from './helpers/whatsappHandler';

registerRoute('get', '/api/v1/whatsapp/config', async (_, res) => {
  try {
    const accountSid = await Secrets.get('TWILIO_ACCOUNT_SID');
    const authToken = await Secrets.get('TWILIO_AUTH_TOKEN');
    const whatsappNumber = await Secrets.get('TWILIO_WHATSAPP_NUMBER');

    res.json({
      ok: true,
      config: {
        accountSid: accountSid || '',
        authToken: authToken || '', // Return actual token for copying
        authTokenMasked: authToken ? '••••••••••••••••' : '', // Masked version for display
        whatsappNumber: whatsappNumber || '',
        provider: 'Twilio Sandbox',
        environment: process.env.NODE_ENV === 'production' ? 'Production' : 'Development',
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch WhatsApp configuration',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}, { protected: true });

registerRoute('post', '/api/v1/whatsapp/webhook', async (req, res) => {
  await whatsappHandler.handleWebhook(req, res);
});

registerRoute('get', '/api/v1/whatsapp/webhook', (req, res) => {
  whatsappHandler.handleVerification(req, res);
});
