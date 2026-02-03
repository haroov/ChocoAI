import { FlowSchema } from '../types';

export const proposalFormFlowSchema: FlowSchema = {
  name: 'ChocoAI Proposal Form Flow',
  slug: 'proposalForm',
  description: 'Collect proposal details and generate carrier PDF forms (MVP)',
  version: 1,
  definition: {
    stages: {
      collectProposalDetails: {
        name: 'Collect proposal details',
        description: 'Collect key proposal details required to generate the PDF proposal form.',
        prompt: [
          'LANGUAGE: Maintain same language throughout. Hebrew → Hebrew. English → English.',
          '',
          'You are Shoko (שוקו), an insurance broker.',
          'Goal: collect the last missing details to complete the proposal form.',
          '',
          'Ask for missing items only (do not repeat what was already collected).',
          'Keep it simple and short.',
          'Prefer ONE short question.',
          'Use a numbered list (1., 2., 3., ...) ONLY when you ask for multiple items from different categories, or when the question would otherwise be long.',
          'Prefer practical defaults.',
          '',
          'Collect:',
          '- business_use (מה הפעילות העיקרית בעסק)',
          '- business_city, business_street, business_house_number (כתובת)',
          '- employees_count (מספר עובדים)',
          '- contents_sum_insured_ils (תכולה - סכום ביטוח)',
          '- stock_sum_insured_ils (מלאי - סכום ביטוח, אם רלוונטי)',
          '- third_party_limit_ils (צד ג׳ - גבול אחריות)',
          '',
          'If the customer says "just standard / whatever you recommend", keep defaults and proceed.',
        ].join('\n'),
        fieldsToCollect: [
          'business_use',
          'business_city',
          'business_street',
          'business_house_number',
          'employees_count',
          'contents_sum_insured_ils',
          'stock_sum_insured_ils',
          'third_party_limit_ils',
        ],
        nextStage: 'saveIntake',
      },
      saveIntake: {
        name: 'Save intake payload',
        description: 'Create a versioned InsuranceIntake payload for this case.',
        fieldsToCollect: [],
        action: {
          toolName: 'insurance.saveIntake',
          condition: 'true',
          allowReExecutionOnError: true,
          onError: {
            behavior: 'pause',
            message: 'יש בעיה זמנית בשמירת טופס ההצעה. אפשר לנסות שוב בעוד רגע.',
          },
        },
        prompt: [
          'CRITICAL: This stage should NOT generate a response message.',
          'Do NOT generate any message.',
          'This stage runs silently to save the intake JSON payload.',
        ].join('\n'),
        nextStage: 'generatePdfs',
      },
      generatePdfs: {
        name: 'Generate PDFs',
        description: 'Generate the carrier PDF proposal form(s) from the latest intake payload.',
        fieldsToCollect: [],
        action: {
          toolName: 'insurance.generatePdfs',
          condition: 'true',
          allowReExecutionOnError: true,
          onError: {
            behavior: 'pause',
            message: 'יש בעיה זמנית ביצירת ה־PDF. אפשר לנסות שוב בעוד רגע.',
          },
        },
        prompt: [
          'CRITICAL: This stage should NOT generate a response message.',
          'Do NOT generate any message.',
          'This stage runs silently to generate the PDF document(s).',
        ].join('\n'),
        nextStage: 'done',
      },
      done: {
        name: 'Done',
        description: 'Proposal PDF generated. Confirm next steps.',
        fieldsToCollect: [],
        prompt: [
          'You are Shoko (שוקו), an insurance broker.',
          'Confirm that the proposal PDF has been generated and we are ready to submit to the insurance carrier.',
          'Ask one short question: "Do you have any additional documents to attach (e.g., business license, previous policy)?"',
          '',
          'Hebrew example:',
          '"מעולה — יצרתי את טופס ההצעה ב־PDF ואפשר להגיש אותו לחברת הביטוח. יש לך מסמכים נוספים לצירוף (למשל רישיון עסק/פוליסה קודמת)?"',
        ].join('\n'),
        nextStage: 'done',
      },
    },
    fields: {
      business_use: {
        type: 'string',
        description: 'Primary business activity / use.',
      },
      business_city: {
        type: 'string',
        description: 'Business city (address).',
      },
      business_street: {
        type: 'string',
        description: 'Business street (address).',
      },
      business_house_number: {
        type: 'string',
        description: 'Business house number (address).',
      },
      employees_count: {
        type: 'number',
        description: 'Number of employees.',
      },
      contents_sum_insured_ils: {
        type: 'number',
        description: 'Contents sum insured in ILS.',
      },
      stock_sum_insured_ils: {
        type: 'number',
        description: 'Stock sum insured in ILS (if applicable).',
      },
      third_party_limit_ils: {
        type: 'number',
        description: 'Third party liability limit per event in ILS.',
      },
    },
    config: {
      initialStage: 'collectProposalDetails',
    },
  },
};

