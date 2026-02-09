import { ZodObject } from 'zod';

/**
 * Options for processing a user message through the flow engine
 */
export type ProcessMessageOptions = {
  /** Optional conversation ID - will be created if not provided */
  conversationId?: string;
  /** The user's message content */
  message: string;
  /** Channel through which the message was received */
  channel: 'web' | 'whatsapp';
  /** Whether to stream the response */
  stream: boolean;
  /** Optional callback to send debug logs to frontend */
  debugCallback?: (level: 'info' | 'warn' | 'error', message: string, data?: any) => void;
}

/**
 * Result of processing a message
 */
export type ProcessMessageResult = {
  /** The conversation ID */
  conversationId: string;
}

/**
 * Context for extracting fields from user messages using LLM
 */
export type FieldsExtractionContext = {
  /** Descriptions of fields to extract, keyed by field slug */
  fieldsDescription: Record<string, string>;
  /** Description of the current stage */
  stageDescription: string;
  /** Optional prompt for additional context */
  stagePrompt?: string;
  /** Zod schema for validating extracted fields */
  zodSchema: ZodObject<any>;
}

/**
 * Options for executing a flow stage
 */
export type FlowExecutionOptions = {
  /** Current stage slug */
  stage: string;
  /** Whether to stream the response */
  stream: boolean;
  /** Conversation ID */
  conversationId: string;
  /** User ID (null if user not yet created) */
  userId: string | null;
  /** Message ID */
  messageId: string;
  /** User's message content */
  message: string;
  /** Fields that have been collected so far */
  collectedFields: string[];
  /** Actual userData values for checking RAW_DATE prefix and other value-based conditions */
  actualUserData?: Record<string, unknown>;
  /** Optional error context */
  errorContext?: string;
  /** Optional flag to disable adaptive tone for this flow invocation (default: true) */
  adaptiveToneEnabled?: boolean;
}

/**
 * Complete flow schema definition
 *
 * @example
 * ```typescript
 * const myFlow: FlowSchema = {
 *   name: 'My Flow',
 *   slug: 'my-flow',
 *   description: 'Flow description',
 *   version: 1,
 *   definition: {
 *     config: { initialStage: 'start' },
 *     stages: { ... },
 *     fields: { ... },
 *   },
 * };
 * ```
 */
export type FlowSchema = {
  /** Human-readable name */
  name: string;
  /** Unique identifier (kebab-case) */
  slug: string;
  /** Description used to determine when to assign this flow */
  description: string;
  /** Version number */
  version: number;
  /** Flow definition containing stages, fields, and config */
  definition: {
    stages: { [stageSlug: string]: FlowStageDefinition };
    fields: { [fieldSlug: string]: FieldDefinition };
    config: FlowSchemaConfig;
  }
}

/**
 * Flow definition (the definition part of FlowSchema)
 */
export type FlowDefinition = FlowSchema['definition']

/**
 * Error handling behavior options
 * - `pause`: Stay in current stage, show error message
 * - `newStage`: Transition to nextStage, show error message
 * - `continue`: Log error, proceed to next stage normally
 * - `endFlow`: Delete UserFlow, end conversation
 */
export type ErrorHandlingBehavior = 'pause' | 'newStage' | 'continue' | 'endFlow';

/**
 * Configuration for error handling in flows
 *
 * Can be configured at stage level or action level (action-level overrides stage-level)
 *
 * @example
 * ```typescript
 * {
 *   behavior: 'pause',
 *   emailTo: 'support@example.com',
 *   message: 'Custom error message with {error} and {stage}',
 *   includeDetails: true,
 * }
 * ```
 *
 * Template variables in `message` and `emailSubject`:
 * - `{error}` - Error message (truncated to 50 chars)
 * - `{stage}` - Current stage slug
 * - `{conversationId}` - Conversation ID
 */
export type ErrorHandlingConfig = {
  /** How to handle the error */
  behavior: ErrorHandlingBehavior;
  /** Email recipient (default: uriel@facio.io from config) */
  emailTo?: string;
  /** Optional email subject (supports template variables) */
  emailSubject?: string;
  /** Whether to include detailed error information in email (default: true) */
  includeDetails?: boolean;
  /** Next stage slug (required if behavior is 'newStage') */
  nextStage?: string;
  /** Custom user message (supports template variables) */
  message?: string;
};

/**
 * Configuration for custom completion checks
 */
export type CustomCompletionCheck = {
  /** JavaScript expression evaluated against userData - if true, use requiredFields instead of fieldsToCollect */
  condition: string;
  /** Fields required when condition is true (overrides fieldsToCollect) */
  requiredFields?: string[];
};

/**
 * Per-stage question orchestration policy for the core prompt builder.
 *
 * This is intentionally generic (no flow-specific logic) and only affects
 * how the core engine instructs the model about message/question batching.
 */
export type StageQuestionPolicy = {
  /**
   * Maximum number of distinct questions the assistant may ask per message,
   * by channel. If not provided, defaults are applied by the engine.
   */
  maxQuestionsPerTurn?: {
    web?: number;
    whatsapp?: number;
  };
  /**
   * Disable the core "bulk collection" instruction (asking for 3+ missing fields
   * in a single turn). Useful for strict 1-question channels (e.g., WhatsApp).
   */
  disableBulkCollectionRule?: boolean;
  /**
   * Suppress the core missing-fields prompting section entirely.
   * Intended for stages that embed their own question-bank orchestration in `stage.prompt`.
   */
  suppressCoreMissingFieldsSection?: boolean;
};

/**
 * Configuration for stage incomplete logging
 */
export type StageIncompleteLogging = {
  /** Log level: 'info' | 'warn' | 'error' | 'debug' */
  logLevel?: 'info' | 'warn' | 'error' | 'debug';
  /** Custom log message (supports template variables: {stageSlug}, {missingFields}, {userData}) */
  message?: string;
  /** Additional data to log (values are JavaScript expressions evaluated against context) */
  extraData?: Record<string, string>;
};

/**
 * Configuration for system prompt hooks
 */
export type SystemPromptHook = {
  /** JavaScript expression to evaluate (against userData + templateContext) - if false, hook is skipped */
  condition?: string;
  /** Prompt lines to inject if condition is true (or always if no condition) */
  promptLines: string[];
};

/**
 * Orchestration configuration for custom stage behavior
 */
export type StageOrchestration = {
  /** Custom completion check function (evaluated after standard check) */
  customCompletionCheck?: CustomCompletionCheck;
  /** Stage-level question orchestration policy for core prompting */
  questionPolicy?: StageQuestionPolicy;
  /** Custom logging on stage incomplete */
  onStageIncomplete?: StageIncompleteLogging;
  /** Custom system prompt hooks */
  systemPromptHooks?: {
    /** Hook to inject custom prompt sections before stage prompt */
    beforePrompt?: SystemPromptHook[];
    /** Hook to inject custom prompt sections after stage prompt */
    afterPrompt?: SystemPromptHook[];
  };
};

/**
 * Error code handler configuration
 */
export type ErrorCodeHandler = {
  /** UserData updates to apply when this error code occurs (values are JavaScript expressions) */
  updateUserData?: Record<string, string>;
  /** Custom error handling behavior (overrides onError) */
  behavior?: ErrorHandlingBehavior;
  /** Next stage if behavior is 'newStage' */
  nextStage?: string;
};

/**
 * Definition of a flow stage
 *
 * @example
 * ```typescript
 * {
 *   name: 'Collect Information',
 *   description: 'Stage description for AI context',
 *   fieldsToCollect: ['name', 'email'],
 *   action: { toolName: 'my.tool' },
 *   nextStage: 'nextStage',
 * }
 * ```
 */
export type FlowStageDefinition = {
  /** Human-readable name (optional) */
  name?: string;
  /** Description passed to AI as context */
  description: string;
  /** Optional prompt for additional instructions */
  prompt?: string;
  /** Array of field slugs that must be collected to complete this stage */
  fieldsToCollect: string[];
  /** Optional context to inject (e.g., ['organization'] for template variables) */
  context?: string[];
  /** Optional flag to disable adaptive tone for this stage (default: true) */
  adaptiveToneEnabled?: boolean;
  /** Optional JavaScript expression that must evaluate to true for stage to be considered complete (evaluated against userData) */
  completionCondition?: string;
  /** Optional hooks for custom orchestration logic */
  orchestration?: StageOrchestration;
  /** Optional action to execute when stage is complete */
  action?: {
    /** Tool name to execute (format: 'scope.tool-name') */
    toolName: string;
    /** Optional condition to evaluate before executing */
    condition?: string;
    /** Allow re-execution even if last message was technical error */
    allowReExecutionOnError?: boolean;
    /** Error code handlers (for structured error handling) */
    onErrorCode?: {
      [errorCode: string]: ErrorCodeHandler;
    };
    /** Action-level error handling (overrides stage-level) */
    onError?: ErrorHandlingConfig;
  },
  /** Stage-level error handling */
  onError?: ErrorHandlingConfig;
  /** Next stage definition - string for direct transition, or object for conditional */
  nextStage?: string | {
    /** Conditional transitions evaluated in order */
    conditional: Array<{
      /** JavaScript expression evaluated against userData */
      condition: string;
      /** Stage slug if condition is true */
      ifTrue: string;
      /** Optional stage slug if condition is false */
      ifFalse?: string;
    }>;
    /** Stage slug if no conditions match */
    fallback: string;
  };
};

/**
 * Definition of a field that can be collected in a flow
 *
 * @example
 * ```typescript
 * {
 *   type: 'string',
 *   description: 'User email address',
 *   pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$',
 * }
 * ```
 */
export type FieldDefinition = {
  /** Field data type */
  type: 'string' | 'boolean' | 'number';
  /** Description for AI to extract this field from messages */
  description: string;
  /** Whether to redact this field in logs */
  sensitive?: boolean;
  /** Minimum length for string fields */
  minLength?: number;
  /** Maximum length for string fields */
  maxLength?: number;
  /** Regex pattern for validation (string fields only) */
  pattern?: string;
  /** Allowed values for string fields */
  enum?: string[];
};

/**
 * Flow schema configuration
 */
export type FlowSchemaConfig = {
  /** The initial stage slug where the flow begins */
  initialStage: string;
  /** Admin UI preferences (non-engine) */
  ui?: {
    fieldsSort?: 'none' | 'priorityAsc';
  };
  /** Whether this flow should be the default for new users (exactly one flow should have this set to true) */
  defaultForNewUsers?: boolean;
  /** Configuration for what happens when the flow completes */
  onComplete?: {
    /** The slug of the flow to start when this flow completes */
    startFlowSlug: string;
    /** Whether to transition seamlessly (no user prompt) or ask the user first */
    mode?: 'seamless' | 'ask';
    /** Fields to copy from current flow to next flow's userData during handoff */
    preserveFields?: string[];
  };
  /** Marks this flow as a router that routes to other flows based on userData conditions */
  isRouterFlow?: boolean;
  /** Field name that determines user type (e.g., 'role' for donor/nonprofit) */
  userTypeField?: string;
  /** Global error handling strategy for this flow */
  errorHandlingStrategy?: {
    /**
     * How to handle unhandled errors that would crash the flow:
     * - 'killFlow': Gracefully end the flow (delete UserFlow, show error message)
     * - 'skip': Continue/retry as much as possible, don't crash (default)
     *
     * This applies when:
     * - Database errors occur during stage transitions
     * - Recursive proceed() calls fail
     * - Other unexpected errors that aren't caught by onError configs
     *
     * @default 'skip'
     */
    onUnhandledError?: 'killFlow' | 'skip';
  };
}
