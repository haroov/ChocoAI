import { FlowSchema } from '../types';

export const kycFlowSchema: FlowSchema = {
  name: 'ChocoAI KYC Flow',
  slug: 'kyc',
  description: 'KYC onboarding flow for entity and payment gateway setup',
  version: 15,
  definition: {
    config: {
      initialStage: 'kycBootstrap',
      onComplete: {
        startFlowSlug: 'campaignManagement',
        mode: 'seamless',
        preserveFields: ['campaign_brief'],
      },
    },
    fields: {
      campaign_brief: {
        type: 'string',
        description: 'Freeform campaign brief (goal/why/audience) collected early to keep the conversation human; optional but recommended.',
      },
      entity_type: {
        type: 'string',
        enum: ['PRIMARY_ORG', 'OTHER_ENTITY'],
        description: 'Which legal entity should receive the campaign funds: the organization itself (PRIMARY_ORG) or a different legal entity (OTHER_ENTITY).',
      },
      org_selection: {
        type: 'string',
        description: 'ID or Name of the organization selected by the user',
      },
      account_organizations_list: {
        type: 'string',
        description: 'Formatted list of available organizations for the user',
      },
      entity_selection: {
        type: 'string',
        description: 'Name of the entity selected by the user, or "new" to create a new one',
      },
      formatted_entity_list: {
        type: 'string',
        description: 'Formatted list of entities for display in prompt',
      },
      entity_name: {
        type: 'string',
        description: 'Full legal name of the entity receiving funds',
      },
      entity_tax_id: {
        type: 'string',
        description: 'Registration / tax ID of the entity (EIN, registration number, etc.)',
      },
      entity_country: {
        type: 'string',
        description: 'Country of registration for the entity (ISO country code: US, IL, etc.)',
      },
      entity_address_line_1: {
        type: 'string',
        description: 'Street address line 1 of the entity',
      },
      entity_address_line_2: {
        type: 'string',
        description: 'Street address line 2 of the entity (optional)',
      },
      entity_city: {
        type: 'string',
        description: 'City where the entity is located',
      },
      entity_state: {
        type: 'string',
        description: 'State/province where the entity is located (optional, required for some countries)',
      },
      entity_zip: {
        type: 'string',
        description: 'ZIP/postal code of the entity address',
      },
      entity_id: {
        type: 'string',
        description: 'Choco API entity ID returned after pushing entity (internal use, do not ask user for this)',
      },
      gateway_providers: {
        type: 'string',
        description: 'Comma-separated list of payment gateway provider names the user wants to use (e.g., "stripe,paypal" or "meshulam,cardcom")',
      },
      gateway_api_key: {
        type: 'string',
        description: 'API key for payment gateway (if required by provider)',
      },
      gateway_user_id: {
        type: 'string',
        description: 'User ID for payment gateway (if required by provider)',
      },
      gateway_org_custom_id: {
        type: 'string',
        description: 'Organization custom ID for payment gateway (if required by provider)',
      },
      kyc_confirmed: {
        type: 'boolean',
        description: 'User confirmation that KYC details are correct',
      },
      has_entities: {
        type: 'boolean',
        description: 'Flag indicating if the organization has existing entities',
      },
      has_existing_gateway: {
        type: 'boolean',
        description: 'Flag indicating if the user has an existing payment gateway',
      },
      meshulam_phone_local: {
        type: 'string',
        // Israeli local phone format for Meshulam/Grow: no +972, starts with 0.
        // Accept 9-10 digits total (mobile is typically 10 digits; landlines can be 9).
        pattern: '^0\\d{8,9}$',
        description: 'Israeli phone number in local format (no +972), used only for Grow (Meshulam) gateway setup (e.g., 0502440556)',
      },
      entity_tax_deductible_receipt: {
        type: 'boolean',
        description: 'Whether the US entity issues tax-deductible receipts',
      },
      gateway_setup_ack: {
        type: 'boolean',
        description: 'User acknowledged they received/opened the gateway setup link (ok/done/פתחתי/נפתח).',
      },
      entity_us_declarations_approved: {
        type: 'string',
        enum: ['I APPROVE'],
        description: 'Confirmation string ("I APPROVE") for US entity declarations',
      },
      bank_account_currency: {
        type: 'string',
        description: 'Currency of the bank account (e.g., USD)',
      },
      bank_account_number: {
        type: 'string',
        description: 'Bank account number',
      },
      bank_account_routing_number: {
        type: 'string',
        description: 'Bank routing number',
      },
      statement: {
        type: 'string',
        description: 'Statement descriptor for the bank account',
      },
      currency: {
        type: 'string',
        description: 'Currency for charges',
      },
      gateway_credentials_raw: {
        type: 'string',
        description: 'Raw credentials provided by user for existing gateway',
      },
      gateway_provider_code: {
        type: 'string',
        description: 'Code of the selected gateway provider (e.g. tranzila)',
      },
      gateway_provider_display: {
        type: 'string',
        description: 'Display name of the provider',
      },
      gateway_required_fields_list: {
        type: 'string',
        description: 'List of fields required for the provider',
      },
      gateway_setup_complete: {
        type: 'boolean',
        description: 'Flag indicating existing gateway is setup',
      },
    },
    stages: {
      kycBootstrap: {
        name: 'KYC Bootstrap',
        description: 'Initialize account context.',
        fieldsToCollect: [],
        action: { toolName: 'login.checkAccountContext' },
        nextStage: {
          conditional: [
            {
              // If has_multiple_orgs is true, go to org selection
              condition: 'has_multiple_orgs === true || has_multiple_orgs === "true"',
              ifTrue: 'kycCampaignWarmup', // Start campaign-first even if multiple orgs
            },
          ],
          fallback: 'kycCampaignWarmup',
        },
      },
      kycCampaignWarmup: {
        name: 'Campaign Warmup',
        description: 'Campaign-first conversation opener before KYC details',
        fieldsToCollect: ['campaign_brief'],
        prompt: [
          'את/ה מנהל/ת קמפיינים מקצועי/ת — חם/ה, חד/ה, ומאוד פרקטי/ת.',
          'המטרה: לגרום ללקוח להתרגש ולהרגיש שמישהו מוביל אותו בביטחון.',
          '',
          'פתח/י במשפט קצר שממסגר את זה: “בוא נרים קמפיין חזק — ובדרך נסדר גם את הצד הטכני כדי שתוכלו לקבל תרומות בלי כאבי ראש.”',
          '',
          'שאל/י שאלה אחת פתוחה שמקבלת תשובה טבעית (לא טופס), ושמור/י אותה ל-campaign_brief:',
          '- “על מה הקמפיין ולמי זה הולך לעזור?”',
          '',
          'אם המשתמש כבר נתן הקשר על הקמפיין בהודעה קודמת — אל תשאל/י שוב; בקש/י לאשר/להוסיף משפט אחד.',
        ].join('\n'),
        nextStage: 'kycGatewayIntroduction',
      },
      kycGatewayIntroduction: {
        name: 'KYC Gateway Introduction',
        description: 'Introduce payment gateway setup and route based on account context',
        prompt: [
          'You are a senior campaign strategist.',
          'Keep this light and human: we’re launching a campaign, and we’ll quickly ensure payouts/donations can work.',
          '',
          'Logic:',
          'If multiple organizations (userData.has_multiple_orgs is true): Ask "Which organization should we set this up for?"',
          'If single organization: Say "We will set this up for [single_org_name]."',
          '',
          'This stage is a router. User response will be effectively selecting organization (if multiple) or acknowledging.',
        ].join('\n'),
        fieldsToCollect: [],
        // If multiple orgs, we collect selection. If single, we might collect acknowledgment or just skip.
        // To be safe, we route content based on context.
        nextStage: {
          conditional: [
            {
              condition: 'has_multiple_orgs === true || has_multiple_orgs === "true"',
              ifTrue: 'kycSelectOrganization',
            },
          ],
          fallback: 'kycLoadEntities', // Skip directly to loading entities for single org
        },
      },
      kycSelectOrganization: {
        name: 'Select Organization',
        description: 'Ask user to select which organization to manage',
        prompt: [
          'מצוין — בוא נוודא שהקמפיין שלך יכול לקבל תרומות בצורה חלקה.',
          '',
          'באיזה מרחב עבודה נריץ את הקמפיין?',
          '{account_organizations_list}',
          '',
          'אפשר לענות עם השם או עם המספר מהרשימה.',
        ].join('\n'),
        fieldsToCollect: ['org_selection'],
        nextStage: 'kycLoadEntities',
      },
      kycLoadEntities: {
        name: 'Load Entities',
        description: 'Load entities for the selected organization',
        fieldsToCollect: [],
        action: {
          toolName: 'kyc.loadOrgEntities',
          allowReExecutionOnError: true,
          onErrorCode: {
            INVALID_ORG_SELECTION: {
              updateUserData: {
                recovery_reset_keys: '"org_selection,selected_org_id,selected_org_name,selected_org_input,available_entities_json,formatted_entity_list,has_entities"',
                recovery_reason: '"Invalid org selection - reselect organization"',
              },
              behavior: 'newStage',
              nextStage: 'kycRecoveryResetOrgSelection',
            },
            ENTITIES_FETCH_FAILED: {
              updateUserData: {
                recovery_reset_keys: '"org_selection,selected_org_id,selected_org_name,selected_org_input,available_entities_json,formatted_entity_list,has_entities"',
                recovery_reason: '"Failed to fetch entities - reselect organization"',
              },
              behavior: 'newStage',
              nextStage: 'kycRecoveryResetOrgSelection',
            },
            JWT_MISSING: {
              behavior: 'pause',
            },
            JWT_INVALID: {
              behavior: 'pause',
            },
          },
        },
        nextStage: 'kycEntityDecision',
      },
      kycRecoveryResetOrgSelection: {
        name: 'Recovery: Reset Org Selection',
        description: 'Clears org selection-related keys and re-routes to org selection',
        fieldsToCollect: [],
        action: {
          toolName: 'flow.resetKeys',
          condition: 'true',
        },
        prompt: [
          'We hit a configuration issue selecting the organization.',
          'We will re-select the organization and continue.',
          'Keep this short.',
        ].join('\n'),
        nextStage: 'kycSelectOrganization',
      },
      kycEntityDecision: {
        name: 'Entity Decision',
        description: 'Decide whether to select existing entity or create new',
        fieldsToCollect: [],
        nextStage: {
          conditional: [
            { condition: 'has_entities === true || has_entities === "true"', ifTrue: 'kycSelectEntity' },
            // If no entities, do NOT auto-default. Ask user if mapped to Org or New Entity.
            { condition: 'true', ifTrue: 'kycSelectReceivingEntity' },
          ],
          fallback: 'kycSelectReceivingEntity',
        },
      },
      kycSelectReceivingEntity: {
        name: 'Select Receiving Entity',
        description: 'For new signups (no entities yet), decide whether the org itself receives funds or another legal entity will.',
        prompt: [
          'מעולה — עכשיו נוודא שהתרומות בקמפיין ייכנסו לגוף הנכון.',
          '',
          'מי אמור לקבל את כספי התרומות בקמפיין?',
          '- העמותה/הארגון עצמו (“{selected_org_name}”)',
          '- ישות משפטית אחרת',
          '',
          'IMPORTANT:',
          '- Set the field "entity_type" silently (PRIMARY_ORG for the org itself, OTHER_ENTITY for a different legal entity).',
          '- Never mention internal enum codes like PRIMARY_ORG / OTHER_ENTITY to the user.',
          '- Do NOT list existing entities here (new signup has none).',
        ].join('\n'),
        fieldsToCollect: ['entity_type'],
        nextStage: {
          conditional: [
            { condition: 'entity_type === "PRIMARY_ORG"', ifTrue: 'kycPrimaryOrgRegNum' },
            { condition: 'entity_type === "OTHER_ENTITY"', ifTrue: 'kycCreateEntityStart' },
          ],
          fallback: 'kycSelectReceivingEntity',
        },
      },
      kycPrimaryOrgRegNum: {
        name: 'Primary Org Registration Number',
        description: 'Collect regNum/EIN for the organization when it is the receiving entity.',
        prompt: [
          'Great — we’ll connect payouts to {selected_org_name}.',
          'What’s the registration number (ע״ר/ח״פ / EIN) exactly as it appears in the registry?',
        ].join('\n'),
        fieldsToCollect: ['entity_tax_id'],
        // Build the entity directly from KYC inputs (no enrichment lookup dependency).
        nextStage: 'kycCreateEntityFinalize',
      },
      kycSelectEntity: {
        name: 'Select Entity',
        description: 'Select from list of entities',
        prompt: [
          'You MUST include the entity list below in your message (do not summarize it, do not omit it).',
          '',
          'היישויות המשפטיות תחת **{selected_org_name}**:',
          '{formatted_entity_list}',
          '',
          'איזו ישות לבחור לקבלת הכספים? אפשר לענות עם **מספר מהרשימה** או **שם הישות**, או לכתוב **"חדש"** כדי ליצור אחרת.',
          '',
          'CRITICAL:',
          '- Never ask for internal IDs.',
        ].join('\n'),
        fieldsToCollect: ['entity_selection'],
        action: { toolName: 'kyc.resolveEntitySelection' }, // Resolves choice to entity_id or isNew
        nextStage: 'kycProcessEntitySelection',
      },
      kycProcessEntitySelection: {
        name: 'Process Entity Selection',
        description: 'Route based on entity selection',
        fieldsToCollect: [],
        nextStage: {
          conditional: [
            // If resolve returned isNew=true (so entity_id is missing or special flag), go to creation
            // Check if entity_id is set.
            { condition: 'entity_id', ifTrue: 'kycLookupExistingEntity' },
          ],
          fallback: 'kycCreateEntityStart',
        },
      },

      // --- Existing Entity Enrichment ---
      kycLookupExistingEntity: {
        name: 'Lookup Existing Entity',
        description: 'Fetch full details for the selected existing entity to ensure address/data completeness.',
        fieldsToCollect: [],
        action: {
          toolName: 'nonprofit.lookup',
          // If lookup fails (e.g. not found externally), just proceed to gateway config without new data
          onError: {
            behavior: 'newStage',
            nextStage: 'kycPaymentGatewayDiscovery',
          },
        },
        nextStage: 'kycEnrichExistingEntity',
      },
      kycEnrichExistingEntity: {
        name: 'Enrich Existing Entity',
        description: 'Map lookup results to entity fields for the existing entity.',
        fieldsToCollect: [],
        action: { toolName: 'kyc.enrichEntity' },
        nextStage: 'kycPaymentGatewayDiscovery',
      },

      kycStripeCollectFields: {
        name: 'Collect Stripe Fields',
        description: 'Collects missing Stripe fields',
        prompt: 'I fetched Stripe’s required fields for this entity. Please provide the missing items: {missing_fields}',
        fieldsToCollect: [
          'bank_account_currency',
          'bank_account_number',
          'bank_account_routing_number',
          'statement',
          'currency',
          // Note: The specific dynamic stripe_* fields will be asked for by the LLM
          // based on the missing_fields context provided in the prompt/error context
        ],
        nextStage: 'kycGatewayPushApi', // Route back to retry pushing
      },

      // --- Smart Entity Creation Flow ---
      // --- Smart Entity Creation Flow ---
      kycCreateEntityStart: {
        name: 'Entity Creation - Start',
        description: 'Start entity creation by collecting Name and Country to determine flow path',
        prompt: [
          'Let\'s create a new entity for your campaign funds.',
          '',
          'INSTRUCTION: Check chat history!',
          '- Did the user already mention the Name or Country? (e.g. "I want to open a fund for MyCharity in Israel")',
          '- If YES: Acknowledge it ("I see you want to set up MyCharity in Israel") and only confirm or ask for missing pieces.',
          '- If NO: Ask for "Full Legal Entity Name" and "Country of Registration".',
          '',
          'Hebrew: "בוא נקים ישות חדשה. (אם כבר ציין שם/מדינה, אשר זאת. אם לא, שאל: מה שם הישות ובאיזו מדינה היא רשומה?)"',
        ].join('\n'),
        fieldsToCollect: ['entity_name', 'entity_country'],
        nextStage: {
          conditional: [
            {
              // US or IL -> Enriched Flow
              condition: 'entity_country === "US" || entity_country === "IL" || entity_country === "Israel" || entity_country === "USA"',
              ifTrue: 'kycCreateEntityTaxId',
            },
          ],
          // All other countries -> Manual Flow
          fallback: 'kycEntityMissingDetails',
        },
      },

      // Path A: Enriched Flow (US/IL)
      kycCreateEntityTaxId: {
        name: 'Entity Creation - Tax ID',
        description: 'Collect Tax ID for US/IL entities to perform lookup',
        prompt: [
          'Thanks. For {entity_country}, we can look up the details automatically.',
          'Please provide the Tax ID / Registration Number (ח.פ. / ע"ר / EIN).',
        ].join('\n'),
        fieldsToCollect: ['entity_tax_id'],
        nextStage: 'kycCreateEntityLookup',
      },
      kycCreateEntityLookup: {
        name: 'Entity Creation - Lookup',
        description: 'Lookup organization details using external API',
        fieldsToCollect: [],
        action: {
          toolName: 'nonprofit.lookup',
          // If lookup fails, fall back to manual entry
          onError: {
            behavior: 'newStage',
            nextStage: 'kycEntityMissingDetails',
          },
        },
        nextStage: 'kycCreateEntityEnrich',
      },
      kycCreateEntityEnrich: {
        name: 'Entity Creation - Enrich',
        description: 'Map lookup results to entity fields',
        fieldsToCollect: [],
        action: { toolName: 'kyc.enrichEntity' },
        nextStage: 'kycCreateEntityConfirm',
      },
      kycCreateEntityConfirm: {
        name: 'Entity Creation - Confirm',
        description: 'Confirm enriched details and collect missing ones',
        prompt: [
          'I found the following details for your entity:',
          '- Name: {entity_name}',
          '- Tax ID: {entity_tax_id}',
          '- Address: {entity_address_line_1}',
          '- City: {entity_city} {entity_zip}',
          '- Country: {entity_country}',
          '',
          'If the details above (especially Name and Tax ID) are correct, just say "Confirmed".',
          'Only ask for missing details if they are ACTUALLY missing from the list above.',
          '',
          'Hebrew: "מצאתי את הפרטים הבאים... אנא אשר. אם כל הפרטים החשובים מופיעים, פשוט כתוב לי \'מאשר\'."',
        ].join('\n'),
        fieldsToCollect: [
          'entity_address_line_1',
          'entity_city',
          'entity_zip',
          // Note: We don't force 'state' or 'line_2' as they are optional/conditional
        ],
        nextStage: {
          // Logic: if entity_country is US -> kycUsEntityDeclarations
          // else -> kycCreateEntityFinalize
          conditional: [
            {
              ifTrue: 'kycUsEntityDeclarations',
              condition: 'entity_country == "US"',
            },
          ],
          fallback: 'kycCreateEntityFinalize',
        },
      },

      // Recovery / Manual completion stage (used both when lookup is unsupported and when build/push fails)
      kycEntityMissingDetails: {
        name: 'Entity Details (Complete Missing)',
        description: 'Collect the remaining payout entity details needed to create/push the entity',
        fieldsToCollect: [
          'entity_name',
          'entity_country',
          'entity_tax_id',
          'entity_address_line_1',
          'entity_city',
          'entity_state',
          'entity_zip',
        ],
        prompt: [
          'You are a senior campaign specialist. Keep it human and confident.',
          'We’re very close — I just need the missing payout/entity details so donations can work smoothly.',
          '',
          'Rules:',
          '- Ask for ONLY what is missing (don’t re-ask fields already present).',
          '- Ask ONE question at a time.',
          '- Do NOT mention internal IDs.',
          '',
          'What we currently have (may be partial):',
          '- Name: {entity_name}',
          '- Country: {entity_country}',
          '- Tax ID: {entity_tax_id}',
          '- Address: {entity_address_line_1}, {entity_city} {entity_state} {entity_zip}',
          '',
          'If the user is in the US and state/ZIP is missing, ask for state + ZIP.',
        ].join('\n'),
        nextStage: 'kycCreateEntityFinalize',
      },

      kycUsEntityDeclarations: {
        name: 'US Entity Declarations',
        description: 'Collects US-specific declarations and tax receipt status',
        prompt: [
          'Two quick questions for this US nonprofit:',
          '1. Should we send **tax-deductible receipts** for donations? (Yes/No)',
          '2. Type **I APPROVE** to confirm all of the following are true:',
          '   * The organization has not had its federal tax-exempt status revoked by the IRS',
          '   * The organization has not had its California tax-exempt status revoked by the CA Franchise Tax Board',
          '   * The organization is not prohibited from soliciting/operating in California',
        ].join('\n'),
        fieldsToCollect: ['entity_tax_deductible_receipt', 'entity_us_declarations_approved'],
        nextStage: 'kycCreateEntityFinalize',
      },

      kycCreateEntityFinalize: {
        name: 'Entity Creation - Finalize',
        description: 'Build complete entity object',
        context: ['organization'],
        fieldsToCollect: [], // We should have everything now
        action: {
          toolName: 'kyc.buildEntity',
          condition: 'true',
          allowReExecutionOnError: true,
          onErrorCode: {
            ORG_DATA_NOT_FOUND: {
              behavior: 'newStage',
              nextStage: 'kycEntityMissingDetails',
            },
            TAX_ID_MISSING: {
              behavior: 'newStage',
              nextStage: 'kycEntityMissingDetails',
            },
          },
          onError: {
            // If build fails, fall back to collecting missing entity details (don’t dead-end).
            behavior: 'newStage',
            nextStage: 'kycEntityMissingDetails',
          },
        },
        nextStage: 'kycEntityPushApi',
      },
      kycPrimaryOrgLookup: {
        name: 'Primary Org Lookup',
        // Recovery stage: older conversations might have been routed here.
        // We no longer depend on external enrichment to build/push the entity.
        description: 'Recovery: try org lookup (non-blocking), then proceed to entity build',
        fieldsToCollect: [],
        action: {
          toolName: 'nonprofit.lookup',
          // Best-effort enrichment: if user gave a reg number, try lookup; if it fails, continue anyway.
          condition: '!!entity_tax_id',
          allowReExecutionOnError: true,
          onError: { behavior: 'continue' },
        },
        prompt: [
          'ממשיך לשלב הבא…',
        ].join('\n'),
        nextStage: 'kycCreateEntityFinalize',
      },
      kycEntityPushApi: {
        name: 'KYC Entity Push API',
        description: 'Push the entity to Choco API and get entity ID',
        prompt: [
          'Creating the entity in our system...',
          'Hebrew: "יוצר את הישות במערכת..."',
        ].join('\n'),
        fieldsToCollect: [],
        action: {
          toolName: 'kyc.pushEntity',
          condition: 'true',
          onErrorCode: {
            JWT_MISSING: { behavior: 'pause' },
            JWT_INVALID: { behavior: 'pause' },
            ENTITY_VALIDATION_FAILED: {
              behavior: 'newStage',
              nextStage: 'kycEntityMissingDetails',
            },
            MISSING_ORG_ID: {
              behavior: 'newStage',
              nextStage: 'kycRecoveryResetOrgSelection',
            },
            ENTITY_PUSH_FAILED: {
              behavior: 'newStage',
              nextStage: 'kycEntityMissingDetails',
            },
          },
          onError: {
            behavior: 'newStage',
            nextStage: 'kycEntityMissingDetails',
            message: 'נתקלתי בתקלה ביצירת הישות — בוא נשלים רגע את הפרטים החסרים וננסה שוב.',
          },
        },
        nextStage: 'kycPaymentGatewayDiscovery',
      },
      kycPaymentGatewayDiscovery: {
        name: 'KYC Payment Gateway Discovery',
        description: 'Identify if user has a gateway and provide setup URL or email service',
        prompt: [
          'Now regarding payment processing (ספק סליקה) — this is so your campaign can receive donations.',
          'Do you already have an active payment gateway for this entity? (Yes/No)',
          '',
          'Logic:',
          '- If user says YES: Ask which provider (just the name).',
          '- If user says NO: DO NOT ask the user to choose a provider. The system will automatically generate the correct setup link:',
          '  * Israel → Grow (Meshulam)',
          '  * Other countries → Stripe',
          '',
          'Extract:',
          '- has_existing_gateway: boolean (true if yes/likely, false if no/none)',
          '- gateway_providers: string (ONLY if user has an existing gateway and mentions the provider name)',
        ].join('\n'),
        fieldsToCollect: ['has_existing_gateway', 'gateway_providers'],
        orchestration: {
          customCompletionCheck: {
            // If the user DOES NOT have a gateway, we can proceed without gateway_providers.
            condition: 'has_existing_gateway === false || has_existing_gateway === "false"',
            requiredFields: ['has_existing_gateway'],
          },
        },
        action: {
          toolName: 'kyc.handleGatewayDiscovery',
          condition: 'true',
          onErrorCode: {
            MESHULAM_INVALID_PHONE: {
              behavior: 'newStage',
              nextStage: 'kycMeshulamPhone',
            },
            MISSING_GATEWAY_SETUP_URL: {
              behavior: 'newStage',
              nextStage: 'kycMeshulamPhone',
            },
            INVALID_BUSINESS_NUMBER: {
              behavior: 'newStage',
              nextStage: 'kycFixBusinessNumber',
            },
          },
        },
        nextStage: {
          conditional: [
            {
              condition: 'has_existing_gateway === true || has_existing_gateway === "true"',
              ifTrue: 'kycValidateGateway', // Changed from kycGatewayEmailIntro
            },
            {
              condition: 'has_existing_gateway === false || has_existing_gateway === "false"',
              ifTrue: 'kycGatewayLink',
            },
          ],
          fallback: 'kycGatewayLink',
        },
      },
      // --- New Stages for Tailored Gateway Flow ---
      kycValidateGateway: {
        name: 'Validate Gateway Provider',
        description: 'Check if the provider is supported and what fields are needed.',
        fieldsToCollect: [],
        action: {
          toolName: 'kyc.validateGatewayProvider',
          // If valid, result.data.isValid will be true and required fields saved
          // If invalid, we fall back to manual email coordination
          onErrorCode: {
            // handle errors
          },
        },
        nextStage: {
          conditional: [
            {
              condition: 'gateway_provider_code', // Existence check (it is set if valid)
              ifTrue: 'kycCollectExistingGatewayDetails',
            },
          ],
          fallback: 'kycGatewayEmailIntro', // Fallback for unsupported/unknown providers
        },
      },
      kycCollectExistingGatewayDetails: {
        name: 'Collect Gateway Details',
        description: 'Collect specific credentials for the selected gateway.',
        prompt: [
          'Great choice. To connect {gateway_provider_display} to your campaign, I need the following details:',
          '{gateway_required_fields_list}',
          '',
          'Please provide them here (or say "skip" to coordinate via email).',
        ].join('\n'),
        fieldsToCollect: ['gateway_credentials_raw'], // We collect the raw message and let tool parse it
        nextStage: 'kycProcessGatewayCredentials',
      },
      kycProcessGatewayCredentials: {
        name: 'Process Gateway Credentials',
        description: 'Parse and save the gateway credentials.',
        fieldsToCollect: [],
        action: {
          toolName: 'kyc.saveGatewayCredentials',
          onError: {
            behavior: 'newStage', // Retry
            nextStage: 'kycCollectExistingGatewayDetails',
            message: 'I missed some details or they were incorrect. Please provide: {missing_fields}',
          },
        },
        nextStage: 'kycGatewayVerify',
      },

      kycFixBusinessNumber: {
        name: 'Fix Business Number',
        description: 'Collect valid business number if Meshulam rejected the previous one',
        fieldsToCollect: ['entity_tax_id'],
        prompt: [
          'The business number you provided was rejected by the payment provider.',
          'Please provide the exact Business Registration Number (H.P. / Amuta Number) as it appears on official documents.',
          'Digits only.',
          '',
          'Hebrew: "מספר העסק שהוזן נדחה על ידי ספק הסליקה. אנא הזן את מספר ח״פ / ע״ר המדויק (ספרות בלבד)."',
        ].join('\n'),
        // IMPORTANT: Do NOT auto-run the gateway tool here (prevents runaway retry loops).
        // After collecting a corrected number, route back to discovery which will run the tool once.
        nextStage: 'kycPaymentGatewayDiscovery',
      },
      kycMeshulamPhone: {
        name: 'Meshulam Phone (Local IL)',
        description: 'Collect a valid Israeli phone number in local format (no +972) for Grow (Meshulam) gateway setup',
        fieldsToCollect: ['meshulam_phone_local'],
        prompt: [
          'To continue setting up Grow (Meshulam), I need an Israeli phone number in LOCAL format only (no +972).',
          'Example: 0502440556',
          '',
          'Hebrew: "כדי להמשיך בהקמה דרך Grow (משולם), צריך מספר נייד ישראלי בפורמט מקומי בלבד (בלי +972). לדוגמה: 0502440556"',
          '',
          'Ask for ONE thing only: the phone number.',
        ].join('\n'),
        // IMPORTANT: Do NOT run gateway discovery here.
        // This stage exists purely to collect a valid local Israeli phone number.
        nextStage: 'kycPaymentGatewayDiscovery',
      },
      kycGatewayLink: {
        name: 'Gateway Setup Link',
        description: 'Provide the correct gateway setup link (no user choice) so the campaign can receive donations',
        fieldsToCollect: ['gateway_setup_ack'],
        // Safety net: if we somehow arrived here without a saved link, generate it now.
        // (This avoids showing "{gateway_setup_url}" literally.)
        action: {
          toolName: 'kyc.handleGatewayDiscovery',
          condition: 'gateway_setup_url == null || gateway_setup_url === ""',
          onErrorCode: {
            MESHULAM_INVALID_PHONE: {
              behavior: 'newStage',
              nextStage: 'kycMeshulamPhone',
            },
            MISSING_GATEWAY_SETUP_URL: {
              behavior: 'newStage',
              nextStage: 'kycMeshulamPhone',
            },
          },
        },
        prompt: [
          'To receive campaign donations, we need an active payment gateway.',
          '',
          'CRITICAL: Do not offer choices. Use the system-selected gateway.',
          '',
          'Israel -> Grow (Meshulam)',
          'Other countries -> Stripe',
          '',
          'Here is your setup link:',
          '{gateway_setup_url}',
          'Link Fallback: {gatewaysetupurl}',
          '',
          'INSTRUCTIONS:',
          '1. Present the link above clearly.',
          '2. Tell the user: "After you fill out the form, the payment gateway company will help you set it up. They will provide us with the relevant details to make the payment gateway active. You will be notified once it\'s done."',
          '3. Ask the user to reply "ok" / "done" (or Hebrew equivalent) after they opened the link.',
          '4. Set gateway_setup_ack=true only after the user acknowledges.',
        ].join('\n'),
        nextStage: {
          conditional: [
            { condition: 'gateway_setup_ack === true || gateway_setup_ack === \"true\"', ifTrue: 'kycComplete' },
          ],
          fallback: 'kycGatewayLink',
        },
      },
      kycGatewayEmailIntro: {
        name: 'Gateway Support Email',
        description: 'If the org already has a gateway, ask which provider and initiate an email support flow',
        fieldsToCollect: [],
        prompt: [
          'Perfect — we work with {gateway_providers}.',
          'Let me email their support and cc you to get the gateway details so we can connect it to your Choco account.',
        ].join('\n'),
      },

      kycGatewayPushApi: {
        name: 'Gateway Push API',
        description: 'Pushes gateway configuration to API',
        action: {
          toolName: 'kyc.addGateway',
          condition: 'true',
          onErrorCode: {
            STRIPE_MISSING_FIELDS: { behavior: 'newStage', nextStage: 'kycStripeCollectFields' },
          },
        },
        // If success, proceed to verify
        fieldsToCollect: [],
        nextStage: 'kycGatewayVerify',
      },
      kycGatewayVerify: {
        name: 'KYC Gateway Verify',
        description: 'Verify that gateways were successfully added and are active',
        prompt: [
          'Verifying that your payment gateway(s) are properly set up.',
          'This step is automated - we will check the gateway status.',
          'Wait for verification results.',
        ].join('\n'),
        fieldsToCollect: [],
        action: {
          toolName: 'kyc.verifyGateways',
          condition: '!!entity_id',
        },
        nextStage: {
          conditional: [
            // D1: Only proceed when we have an ACTIVE gateway.
            { condition: 'has_active_gateway === true || has_active_gateway === "true"', ifTrue: 'kycConfirmation' },
          ],
          fallback: 'kycGatewayNotActive',
        },
      },
      kycGatewayNotActive: {
        name: 'Gateway Not Active Yet',
        description: 'Continue gateway remediation until at least one gateway is active=true',
        fieldsToCollect: ['gateway_setup_ack'],
        prompt: [
          'We’re almost there — the payment setup isn’t active yet.',
          'This can happen if the provider onboarding wasn’t completed, or if details are still missing.',
          '',
          'Ask ONE question:',
          '- Have you completed/opened the payment setup link and submitted the details? (yes/no)',
          '',
          'If they say yes: ask them to type "retry" so we can check again.',
          'If they say no: guide them to complete the setup link we provided and then say "retry".',
          '',
          'Do NOT talk about "verified" as a blocker. We only need active=true for V1 routing.',
        ].join('\n'),
        nextStage: 'kycGatewayVerify',
      },
      kycConfirmation: {
        name: 'KYC Confirmation',
        description: 'Summarize KYC setup and get user confirmation',
        prompt: [
          'Here\'s what we\'ve set up for this campaign:',
          '',
          '**Receiving entity:**',
          '- Name: **{entity_name}**',
          '- Registration / tax ID: **{entity_tax_id}**',
          '- Country: **{entity_country}**',
          '- Address: **{entity_address_line_1}, {entity_city} {entity_zip}**',
          '',
          '**Payment gateways now active in your Choco account:**',
          '{List gateways from verification results}',
          '',
          'I\'ll also send your details to the payment providers (where relevant) and cc you to finalize credentials if needed.',
          '',
          'Do you confirm that these details are correct for KYC and payment setup?',
          '',
          'Wait for user confirmation (yes/no). If confirmed, mark kyc_confirmed as true.',
        ].join('\n'),
        fieldsToCollect: ['kyc_confirmed'],
        action: {
          toolName: 'kyc.completeKyc',
          condition: 'kyc_confirmed === true',
          onErrorCode: {
            NO_ACTIVE_GATEWAY: { behavior: 'newStage', nextStage: 'kycGatewayNotActive' },
          },
        },
        nextStage: 'kycComplete', // End of flow
      },
      kycComplete: {
        name: 'KYC Complete',
        description: 'KYC flow completed successfully',
        fieldsToCollect: [],
        prompt: 'KYC setup is complete! You are now entering Campaign Management.',
      },
    },
  },
};
