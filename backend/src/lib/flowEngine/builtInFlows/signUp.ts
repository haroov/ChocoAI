import { FlowSchema } from '../types';

export const signUpFlowSchema: FlowSchema = {
  name: 'ChocoAI Registration Flow',
  slug: 'sign-up',
  description: 'JSON schema for ChocoAI registration flow stages and transitions',
  version: 4,
  definition: {
    stages: {
      intent: {
        name: 'Intent',
        description: 'Confirm the user wants to register and determine if user is donor or nonprofit.',
        prompt: [
          'LANGUAGE: Maintain same language throughout. Hebrew → Hebrew. English → English.',
          '',
          'HEBREW: Use "תורם/תורמת" (not "כתרם"). Use "עמותה" or "ארגון ללא כוונות רווח" for nonprofits.',
          '',
          'Tone: warm, human, and confident — like a campaign specialist who also handles the process.',
          'Be brief. Ask ONE question: "Are you registering mainly as a donor, or as an organization managing a campaign?"',
        ].join('\n'),
        orchestration: {
          systemPromptHooks: {
            beforePrompt: [
              {
                // Fix ReferenceError: Check typeof first since role might be completely missing
                condition: 'typeof role === "undefined" || role === null || role === ""',
                promptLines: [
                  'CONTEXT: User may have just switched from Login flow.',
                  'OBJECTIVE: You MUST ask the user for their role.',
                  'Do NOT infer "donor" or "nonprofit" from a simple "Yes".',
                  'If user said "Yes", ASK: "Are you registering as a Donor or a Nonprofit?"',
                  'Only set the "role" field if the user explicitly answers "Donor" or "Nonprofit" (or Hebrew equivalents).',
                ],
              },
            ],
          },
        },
        fieldsToCollect: ['intent_confirmed', 'role', 'already_registered'],
        nextStage: {
          conditional: [
            {
              condition: 'already_registered === true',
              ifTrue: 'handoffToLogin',
            },
            {
              condition: 'role === "nonprofit"',
              ifTrue: 'collectNonprofitProfile',
            },
            {
              condition: 'role === "donor"',
              ifTrue: 'collectDonorProfile',
            },
          ],
          fallback: 'intent',
        },
      },
      // Login stage removed.
      collectDonorProfile: {
        name: 'Collect donor profile',
        description: 'Gather donor profile information',
        fieldsToCollect: ['first_name', 'last_name', 'email', 'already_registered'],
        prompt: [
          'You are a campaign specialist with a donor-friendly vibe.',
          'Keep it light and efficient.',
          '',
          'Ask for the minimum details to create the donor profile:',
          '- first name',
          '- last name',
          '- email',
          '',
          'If the user hints they already have an account, set already_registered=true and stop asking questions.',
        ].join('\n'),
        nextStage: {
          conditional: [
            {
              condition: 'already_registered === true',
              ifTrue: 'handoffToLogin',
            },
            {
              condition: 'true',
              ifTrue: 'signupDonor',
            },
          ],
          fallback: 'signupDonor',
        },
      },
      collectNonprofitProfile: {
        name: 'Collect nonprofit profile',
        description: 'Gather nonprofit profile information',
        orchestration: {
          systemPromptHooks: {
            beforePrompt: [
              {
                condition: 'true',
                promptLines: [
                  '!!! CRITICAL CHECK FIRST !!!',
                  'Did the user just say they ALREADY have an account? (e.g. "יש לי כבר משתמש", "I am registered")',
                  'If YES -> Set "already_registered" = true IMMEDIATELY. Do NOT ask for name/email.',
                  'If YES -> Your response must be SHORT/EMPTY to allow the system to transition you to Login flow.',
                ],
              },
            ],
          },
        },
        prompt: [
          'You are a senior fundraising campaign specialist.',
          'Goal: get them set up quickly so we can move on to launching a great campaign.',
          '',
          'Priority #1: If the user implies they ALREADY have an account → set already_registered=true and STOP asking questions.',
          '',
          'Otherwise, collect (naturally, not like a form):',
          '- organization_name',
          '- first_name + last_name',
          '- email (validate format)',
          '- phone (mobile preferred)',
          '',
          'Guidelines:',
          '- Warm, human, confident.',
          '- If they give multiple details at once, accept them all.',
          '- Ask ONE question at a time only for the missing piece.',
        ].join('\n'),
        fieldsToCollect: [
          'organization_name',
          'first_name',
          'last_name',
          'email',
          'phone',
          'already_registered',
        ],
        nextStage: {
          conditional: [
            {
              condition: 'already_registered === true',
              ifTrue: 'handoffToLogin',
            },
            {
              // Check if any REQUIRED fields are missing
              // Note: phone is required but sometimes extracted as contact_phone?
              // fieldsToCollect has 'phone', 'email', 'first_name', 'last_name', 'organization_name'
              condition: '!organization_name || !first_name || !last_name || !email || !phone',
              ifTrue: 'collectNonprofitProfile',
            },
            {
              condition: 'true',
              ifTrue: 'signupNonprofit',
            },
          ],
          fallback: 'collectNonprofitProfile',
        },
      },
      signUpSuccess: {
        name: 'SignUp Success',
        description: 'Registration completed. Now transitioning to KYC flow for entity and payment gateway setup.',
        prompt: [
          'CRITICAL: This stage should NOT generate a response message.',
          'The system automatically transitions to KYC flow immediately.',
          'Do NOT generate any message for signUpSuccess - the transition happens programmatically.',
          'If somehow a response is generated, make it ONE brief sentence: "הרשמה הושלמה בהצלחה." and stop.',
          'The system will IMMEDIATELY continue to the next stage automatically.',
        ].join('\n'),
        fieldsToCollect: [],
        // After this stage, the system automatically transitions to KYC flow
        // This is handled programmatically in flowRouter
      },

      signupDonor: {
        name: 'Signup Donor',
        description: 'Register donor with Choco API',
        fieldsToCollect: [],
        action: {
          toolName: 'choco.signup',
          onErrorCode: {
            ALREADY_REGISTERED: {
              updateUserData: {
                targetFlowSlug: '"login"',
              },
              behavior: 'newStage',
              nextStage: 'handoffToLogin',
            },
          },
          onError: {
            // Do NOT handoff on generic errors. Only ALREADY_REGISTERED should route to login.
            behavior: 'pause',
            message: 'יש תקלה זמנית בהרשמה. אפשר לנסות שוב בעוד רגע.',
          },
        },
        nextStage: 'verifyPhoneOrEmail',
      },
      signupNonprofit: {
        name: 'Signup Nonprofit',
        description: 'Register nonprofit with Choco API',
        fieldsToCollect: [],
        action: {
          toolName: 'choco.signup',
          onErrorCode: {
            ALREADY_REGISTERED: {
              updateUserData: {
                targetFlowSlug: '"login"',
              },
              behavior: 'newStage',
              nextStage: 'handoffToLogin',
            },
          },
          onError: {
            // Do NOT handoff on generic errors. Only ALREADY_REGISTERED should route to login.
            behavior: 'pause',
            message: 'יש תקלה זמנית בהרשמה. אפשר לנסות שוב בעוד רגע.',
          },
        },
        nextStage: 'verifyPhoneOrEmail',
      },
      handoffToLogin: {
        name: 'Handoff to Login',
        description: 'Transition the user to the Login flow because they are already registered.',
        fieldsToCollect: [], // No fields needed, targetFlowSlug must be in userData
        action: {
          toolName: 'choco.handoff-to-login',
          // If handoff fails, we kill the flow
          onError: {
            behavior: 'pause',
            message: 'Technical issue switching to login. Please restart.',
          },
        },
        // Avoid confusing UX — do not narrate internal transitions.
        // The login flow will immediately send the OTP message.
        prompt: [
          // IMPORTANT: FlowEngine auto-skips stages that include one of these exact substrings:
          // - "should not generate a response message"
          // - "do not generate any message"
          'CRITICAL: This stage should NOT generate a response message.',
          'Do NOT generate any message.',
          'The system is transitioning the user into the login flow.',
          'Do NOT say anything about switching flows.',
        ].join('\n'),
        nextStage: 'signUpSuccess', // Unreachable ideally, as handoff switches flow
      },
      // sendLoginOTP stage removed.
      verifyPhoneOrEmail: {
        name: 'Verify Phone or Email',
        description: 'Verify user email with verification code sent after signup',
        fieldsToCollect: ['verification_code'],
        action: {
          toolName: 'choco.verify-code',
          allowReExecutionOnError: true,
          onError: {
            behavior: 'pause',
            message: 'Verification code is incorrect. Please try again.',
          },
        },
        orchestration: {
          systemPromptHooks: {
            beforePrompt: [
              {
                condition: 'true',
                promptLines: [
                  '=== VERIFICATION STAGE CONTEXT ===',
                  'We just sent a verification code for NEW REGISTRATION.',
                ],
              },
            ],
          },
        },
        prompt: [
          'Be concise and friendly (campaign specialist tone, not robotic).',
          'Ask the user to paste the verification code we just sent (same code for email/phone).',
        ].join('\n'),
        nextStage: {
          conditional: [
            // Donors should NOT go into KYC; they go to a donor support mini-flow.
            { condition: 'role === "donor"', ifTrue: 'donorSupportHandoff' },
          ],
          fallback: 'signUpSuccess',
        },
      },
      donorSupportHandoff: {
        name: 'Donor Support Handoff',
        description: 'After donor signup, ask how we can help and transition to donor support flow',
        fieldsToCollect: [],
        action: {
          toolName: 'flow.handoff',
          condition: 'true',
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore - flow schema typing does not model arbitrary tool payload keys
          targetFlowSlug: 'donorSupport',
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore - flow schema typing does not model arbitrary tool payload keys
          preserveFields: ['role', 'first_name', 'last_name', 'email', 'phone'],
          onError: {
            behavior: 'pause',
            message: 'יש תקלה זמנית בפתיחת תמיכה. אפשר לכתוב כאן את הבקשה שלך ואני אנסה שוב.',
          },
        },
        prompt: [
          'Be warm and concise.',
          'Ask: "How can I help?"',
          'Hebrew: "בשמחה — איך אוכל לעזור?"',
          'English: "Happy to help — what do you need?"',
        ].join('\n'),
        nextStage: 'donorSupportHandoff',
      },
    },
    fields: {
      intent_confirmed: {
        type: 'boolean',
        description: [
          'Intent to register confirmation.',
          'CRITICAL: This must be set to true as soon as the user selects their role (donor or nonprofit).',
          'If the user has indicated they want to register as either "donor" or "nonprofit", set this to true immediately.',
          'This field should be true whenever the role field is set to either "donor" or "nonprofit".',
        ].join(' '),
      },
      role: {
        type: 'string',
        enum: ['donor', 'nonprofit'],
        description: [
          'User registration type. Must be exactly "donor" or "nonprofit".',
          'Map Hebrew terms: עמותה/ארגון ללא כוונות רווח/מלכ"ר → "nonprofit", תורם/תורמת → "donor".',
          'CRITICAL: Do NOT guess this value. If the user has not explicitly stated they are a donor or nonprofit, leave this field empty.',
          'Value "user" is INVALID.',
        ].join(' '),
      },
      first_name: {
        type: 'string',
        minLength: 1,
        description: 'User\'s first name',
      },
      last_name: {
        type: 'string',
        minLength: 1,
        description: 'User\'s last name',
      },
      email: {
        type: 'string',
        pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
        description: 'User\'s email address. The system will validate the format.',
      },
      organization_name: {
        type: 'string',
        minLength: 1,
        description: 'Organization name for nonprofits',
      },
      phone: {
        type: 'string',
        pattern: '^\\+?[1-9]\\d{1,14}$',
        description: 'Phone number. The system will automatically format it correctly based on the user\'s input and context.',
      },
      website: {
        type: 'string',
        description: 'Organization website URL',
      },
      regNum: {
        type: 'string',
        description: 'Organisation registration number',
      },
      verification_code: {
        type: 'string',
        description: 'Verification code sent to user\'s email. User must enter this code to verify their email address.',
      },
      // already_registered and login_identifier removed/not used for Logic anymore
      already_registered: {
        type: 'boolean',
        description: 'Flag to indicate user is already registered (extracted from context or error).',
      },
    },
    config: {
      initialStage: 'intent',
      onComplete: {
        startFlowSlug: 'kyc',
        mode: 'seamless',
      },
    },
  },
};
