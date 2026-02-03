/**
 * Memory scope types for organizing memory data
 */
export type MemoryScope = 'user' | 'organization' | 'flow' | 'conversation';

/**
 * User memory structure
 */
export interface UserMemory {
  userId: string;
  personalDetails: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    language?: 'hebrew' | 'english';
    role?: 'donor' | 'nonprofit';
  };
  preferences: Record<string, unknown>;
  roles: string[];
  flags: Record<string, boolean>;
}

/**
 * Organization memory structure
 */
export interface OrganizationMemory {
  organizationId: string;
  details: {
    name?: string;
    taxId?: string;
    country?: string;
    address?: Record<string, string>;
  };
  kycState: {
    entityId?: string;
    gateways?: string[];
    verified?: boolean;
  };
  riskFlags: Record<string, boolean>;
}

/**
 * Flow memory structure (wraps current userData)
 */
export interface FlowMemory {
  userId: string;
  flowSlug: string;
  stageData: Record<string, unknown>; // Current userData structure
  completedStages: string[];
  startedAt: Date;
  completedAt?: Date;
}

/**
 * Conversation memory structure
 */
export interface ConversationMemory {
  conversationId: string;
  facts: Array<{
    key: string;
    value: unknown;
    confidence?: number;
    source: 'user' | 'llm' | 'system';
    timestamp: Date;
  }>;
  lastBehavior: {
    stage?: string;
    action?: string;
    timestamp: Date;
  };
  openIssues: string[];
}
