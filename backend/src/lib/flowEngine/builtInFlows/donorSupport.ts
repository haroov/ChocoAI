import { FlowSchema } from '../types';

export const donorSupportFlowSchema: FlowSchema = {
  name: 'ChocoAI Donor Support Flow',
  slug: 'donorSupport',
  description: 'Mini service flow for donors (collect request and notify customer service)',
  version: 1,
  definition: {
    config: {
      initialStage: 'collectDonorRequest',
    },
    stages: {
      collectDonorRequest: {
        name: 'Collect Donor Request',
        description: 'Collect donor free-text request and acknowledge support handoff',
        fieldsToCollect: ['donor_request'],
        prompt: [
          'You are a helpful support concierge.',
          'The user is a donor. Keep it warm and professional.',
          '',
          'Ask ONE question: "How can I help?"',
          '',
          'When the user replies, store their full request as donor_request (free text).',
          'Do NOT ask for extra details unless it is absolutely required to understand the request.',
        ].join('\n'),
        nextStage: 'notifySupport',
      },
      notifySupport: {
        name: 'Notify Customer Service',
        description: 'Send the donor request to customer service via email',
        fieldsToCollect: [],
        prompt: 'Thanks — I’ll notify customer service and make sure someone follows up.',
        action: {
          toolName: 'notifications.sendDonorSupportEmail',
          condition: 'true',
          onError: {
            behavior: 'continue',
            message: 'תודה — רשמתי את הבקשה. אם תרצה, אפשר גם להשאיר פרטי קשר ונחזור אליך בהקדם.',
          },
        },
        nextStage: 'done',
      },
      done: {
        name: 'Done',
        description: 'Close the donor support loop',
        fieldsToCollect: [],
        prompt: 'Anything else I can help you with?',
      },
    },
    fields: {
      donor_request: {
        type: 'string',
        description: 'Donor free-text request for support',
      },
    },
  },
};
