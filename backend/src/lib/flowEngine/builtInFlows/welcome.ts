import { FlowSchema } from '../types';

export const welcomeFlowSchema: FlowSchema = {
  name: 'ChocoAI Welcome Flow',
  slug: 'welcome',
  description: 'Entry router for insurance conversations: start quote vs login vs support vs learn',
  version: 4,
  definition: {
    stages: {
      collectBasics: {
        name: 'Collect basics',
        description: 'Collect basic contact details to start the conversation and persist user context.',
        prompt: [
          '=== CRITICAL STATE RULES (MUST FOLLOW) ===',
          '',
          'LANGUAGE: Maintain same language throughout. Hebrew → Hebrew. English → English.',
          '',
          '=== UX / COPYWRITING ===',
          '',
          'You are a senior insurance broker (שוקו).',
          'Tone: professional, warm, confident. Not a technical bot.',
          '',
          'Start with ONE short welcome line + immediately ask for basic details.',
          'Ask ONE question at a time.',
          '',
          'Prefer ONE short question.',
          'Use a numbered list (1., 2., 3., ...) ONLY when you ask for multiple items from different categories, or when the question would otherwise be long.',
          '',
          '- English: "Hi — I\'m Shoko, your insurance agent. To get started, please share: 1) first name 2) last name 3) mobile number"',
          '- Hebrew: "היי — אני שוקו, סוכן הביטוח שלך. כדי להתחיל, אשמח ל־1) שם פרטי 2) שם משפחה 3) מספר נייד"',
          '',
          'If the user provides only part of the details, ask for the missing piece next.',
        ].join('\n'),
        fieldsToCollect: ['first_name', 'last_name', 'phone'],
        nextStage: 'intent',
      },
      intent: {
        name: 'Intent',
        description: 'Determine user intent: start a new insurance quote, login to an existing account, continue/support an existing policy/case, or learn about Choco.',
        action: {
          // Deterministic intent-confidence gate + telemetry.
          // Decides whether to ask an account/policy confirmation question only when ambiguous.
          toolName: 'welcome.intentGate',
          condition: 'true',
          allowReExecutionOnError: true,
          onError: { behavior: 'continue' },
        },
        prompt: [
          '=== CRITICAL STATE RULES (MUST FOLLOW) ===',
          '',
          'LANGUAGE: Maintain same language throughout. Hebrew → Hebrew. English → English.',
          '',
          'EXIT CONDITIONS (set these fields to transition):',
          '',
          '1. START A NEW QUOTE:',
          '   - intent_type = "quote"',
          '   - already_registered = false (default)',
          '   - intent_confirmed = true',
          '   - Optionally set product_line if the user clearly asked for: business_package / cyber / med_pi',
          '',
          '2. LOGIN (existing user / existing case):',
          '   - intent_type = "login"',
          '   - already_registered = true',
          '   - intent_confirmed = true',
          '   - Send ONE brief confirmation: "Ok — let\'s log in." (Hebrew: "בסדר — נתחבר.")',
          '   - Then stop talking (system will transition automatically)',
          '',
          '3. LEARN ABOUT CHOCO:',
          '   - intent_type = "learn"',
          '   - learn_loops = (learn_loops || 0) + 1',
          '   - Provide brief, compelling information (1-2 sentences) about digital insurance buying with an agent.',
          '   - ALWAYS end with: "Are you looking for a new quote or do you need help with an existing policy/case?"',
          '   - If learn_loops >= 2, be more direct: "To tailor this: is it a new quote or an existing policy/case?"',
          '   - Once user chooses, update intent_type accordingly',
          '',
          'AMBIGUOUS CASES:',
          '- If the user says "I need a policy/certificate/claim/renewal" but it\'s unclear whether it\'s an existing case: ask ONE question first and do NOT set intent_type yet.',
          '',
          '=== UX / COPYWRITING ===',
          '',
          'You are a senior insurance broker (שוקו).',
          'Tone: professional, warm, confident. Not a technical bot.',
          '',
          'Do NOT ask for name/phone again (already collected).',
          'Ask ONE short question to clarify intent: new quote vs existing policy/case.',
          '',
          '- English: "Is this for a new quote, or do you need help with an existing policy/case?"',
          '- Hebrew: "זה להצעה חדשה או שצריך עזרה עם פוליסה/תיק קיים?"',
          '',
          '=== INTENT CONFIDENCE GATE (DETERMINISTIC) ===',
          '',
          'The system sets:',
          '- needs_account_confirmation (boolean)',
          '- intent_confidence (0..1)',
          '- confirmation_asked (boolean) for telemetry',
          '',
          'Rules:',
          '- If needs_account_confirmation=true AND the user has not answered yet: Ask ONE question: "Is this about an existing policy/case or a new quote?" and do NOT set intent_type yet.',
          '- If needs_account_confirmation=false: Do NOT ask that question. Route directly based on the user’s intent (login vs quote).',
          '- If the user explicitly references an existing account/policy (e.g., "in my account", "renew my policy", "claim"): treat as login/support (already_registered=true).',
          '',
          'Be brief and friendly.',
        ].join('\n'),
        // IMPORTANT: Only collect fields required for routing.
        // product_line is optional; learn_loops is only relevant when intent_type="learn".
        fieldsToCollect: ['intent_confirmed', 'already_registered', 'intent_type'],
        nextStage: {
          conditional: [
            {
              condition: 'intent_type === "login" || already_registered === true',
              ifTrue: 'complete', // Transition to login flow
            },
            {
              condition: 'intent_type === "quote"',
              ifTrue: 'complete', // Transition to signUp flow
            },
          ],
          fallback: 'intent', // Stay in intent if still learning
        },
      },
      complete: {
        name: 'Complete',
        description: 'Transition stage - automatically routes to the appropriate flow based on intent_type',
        fieldsToCollect: [],
        action: {
          toolName: 'welcome.route',
          condition: 'intent_type && (intent_type === "quote" || intent_type === "login")',
        },
        prompt: [
          'CRITICAL: This stage should NOT generate a response message.',
          'The system automatically transitions to the appropriate flow immediately.',
          'Do NOT generate any message for complete - the transition happens programmatically.',
        ].join('\n'),
      },
    },
    fields: {
      first_name: {
        type: 'string',
        description: 'Customer first name.',
      },
      last_name: {
        type: 'string',
        description: 'Customer last name.',
      },
      phone: {
        type: 'string',
        description: 'Customer mobile phone (prefer Israeli mobile).',
      },
      intent_confidence: {
        type: 'number',
        description: 'Deterministic confidence score (0..1) for inferred intent (telemetry).',
      },
      needs_account_confirmation: {
        type: 'boolean',
        description: 'Whether the system should ask the account-confirmation question (telemetry + routing guard).',
      },
      confirmation_asked: {
        type: 'boolean',
        description: 'Whether the system asked "Do you already have an account?" in this conversation (telemetry).',
      },
      intent_confirmed: {
        type: 'boolean',
        description: [
          'Intent confirmation.',
          'CRITICAL: This must be set to true as soon as the user selects their intent (quote or login).',
        ].join(' '),
      },
      intent_type: {
        type: 'string',
        enum: ['quote', 'login', 'learn', 'support'],
        description: [
          'User intent type: "quote" (new insurance quote), "login" (existing account/case), "support" (policy support), or "learn" (learn about Choco).',
          'If "learn", provide brief info but always guide back to quote vs existing policy/case.',
        ].join(' '),
      },
      product_line: {
        type: 'string',
        enum: ['business_package', 'cyber', 'med_pi'],
        description: [
          'Insurance product line (high level).',
          '- business_package: עסק / בית עסק / מבנה+תכולה+צד ג + חבות מעבידים וכו\'',
          '- cyber: סייבר',
          '- med_pi: אחריות מקצועית רפואית/פרא-רפואית (Med PI)',
        ].join(' '),
      },
      already_registered: {
        type: 'boolean',
        description: [
          'Whether the user is already registered / has an existing policy/case context that requires login.',
        ].join(' '),
      },
      learn_loops: {
        type: 'number',
        description: 'Number of times user has asked to learn about Choco (used to prevent infinite loops). Increment this each time intent_type is set to "learn".',
      },
    },
    config: {
      initialStage: 'collectBasics',
      defaultForNewUsers: true,
      isRouterFlow: true,
      // Note: welcome.route tool handles routing, not onComplete
      // onComplete is intentionally omitted to avoid conflicts
    },
  },
};
