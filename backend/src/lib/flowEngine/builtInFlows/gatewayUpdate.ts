import { FlowSchema } from '../types';

export const gatewayUpdateFlowSchema: FlowSchema = {
  name: 'Gateway Update Flow',
  slug: 'gateway-update',
  description: 'Handle asynchronous gateway updates (e.g. from Grow email ingestion) by collecting final OTP.',
  version: 1,
  definition: {
    config: {
      initialStage: 'collectOtp',
      onComplete: {
        // Return to dashboard or end flow
        startFlowSlug: 'kyc', // Fallback to KYC/Dashboard
        mode: 'seamless',
      },
    },
    fields: {
      otp: {
        type: 'string',
        description: 'One Time Password provided by the Payment Provider (Grow/Meshulam)',
      },
    },
    stages: {
      collectOtp: {
        name: 'Collect OTP',
        description: 'Ask the user for the OTP they received from the provider.',
        prompt: [
          'The user has been notified that Grow/Meshulam is ready.',
          'Ask them to provide the OTP (Code) they received via SMS/Email from Grow.',
          'Hebrew: "כדי לסיים את החיבור למשולם, אנא הזן את קוד האימות (OTP) שקיבלת מהם כעת."',
          'English: "To finalize the connection with Grow/Meshulam, please enter the OTP you received from them."',
        ].join('\n'),
        fieldsToCollect: ['otp'],
        nextStage: 'finalizeUpdate',
      },
      finalizeUpdate: {
        name: 'Finalize Update',
        description: 'Call the tool to delete the old gateway and create the new one using the OTP and stored credentials.',
        fieldsToCollect: [],
        action: {
          toolName: 'kyc.finalizeGatewayUpdate',
          onError: {
            behavior: 'pause',
            message: 'Failed to finalize gateway. Please check the code and try again.',
          },
        },
        prompt: [
          'CRITICAL: Do NOT generate a response while the action is running.',
          'If successful, the tool will complete the process.',
          'If succesful, say: "Done ✅ Your Grow account is now active and connected to Choco!"',
          'Hebrew: "בוצע ✅ חשבון משולם שלך פעיל ומחובר לשוקו!"',
        ].join('\n'),
        // No next stage - flow ends or redirects via tool/config
      },
    },
  },
};
