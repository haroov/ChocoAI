export interface FlowSummary {
  id: string;
  name: string;
  slug: string;
  version: string;
  description?: string;
}

export interface FlowDetail extends FlowSummary {
  definition?: FlowDefinition;
}

export interface FlowPayload {
  name: string;
  slug: string;
  description: string;
}

//
export type FlowSchema = {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: number;
  definition: {
    stages: { [stageSlug: string]: FlowStageDefinition };
    fields: { [fieldSlug: string]: FieldDefinition };
    config: FlowSchemaConfig;
  }
}

export interface NewFlowPayload {
  name: string;
  slug: string;
  description: string;
}

export type FlowDefinition = FlowSchema['definition'];

export type FlowStageDefinition = {
  name?: string;
  description: string;
  prompt?: string;
  fieldsToCollect: string[];
  action?: {
    toolName: string;
    condition?: string;
  },
  nextStage?: string | {
    conditional: Array<{
      condition: string;
      ifTrue: string;
      ifFalse?: string;
    }>;
    fallback: string;
  };
};

export type NextStageWithConditions = {
  conditional: Array<ConditionalItem>;
  fallback: string;
}

export type ConditionalItem = {
  condition: string;
  ifTrue: string;
  ifFalse?: string;
}

export type FieldDefinition = {
  type: 'string' | 'boolean' | 'number';
  description: string;
  sensitive?: boolean;
  /** Optional priority for ordering questions/fields (lower = earlier) */
  priority?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
};

export type FlowSchemaConfig = {
  initialStage: string;
  ui?: {
    /** How to sort fields in the admin UI */
    fieldsSort?: 'none' | 'priorityAsc';
  };
}

export type FlowGraphNode = {
  stageSlug: string;
  x: number;
  y: number;
  isFinal: boolean;
}

export enum FlowGraphEdgeKind {
  Fixed,
  Conditional,
  Fallback,
}

export type FlowGraphEdge = {
  from: string;
  to: string;
  kind: FlowGraphEdgeKind;
}
