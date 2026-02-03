import { logger } from '../../utils/logger';
import { FlowSchema, FlowDefinition, FlowStageDefinition } from './types';
import { llmService } from './llmService';

export type FlowModificationOperation =
  | { type: 'modifyPrompt'; stageSlug: string; newPrompt: string }
  | { type: 'addField'; stageSlug: string; fieldSlug: string; position?: number }
  | { type: 'removeField'; stageSlug: string; fieldSlug: string }
  | { type: 'reorderFields'; stageSlug: string; fieldOrder: string[] }
  | { type: 'createStage'; stageSlug: string; stage: FlowStageDefinition }
  | { type: 'deleteStage'; stageSlug: string }
  | { type: 'modifyTransition'; stageSlug: string; nextStage: string | FlowStageDefinition['nextStage'] }
  | { type: 'addAction'; stageSlug: string; action: { toolName: string; condition?: string } }
  | { type: 'removeAction'; stageSlug: string }
  | { type: 'modifyAction'; stageSlug: string; action: { toolName: string; condition?: string } }
  | { type: 'addFieldDefinition'; fieldSlug: string; field: any }
  | { type: 'modifyFieldDefinition'; fieldSlug: string; field: Partial<any> }
  | { type: 'deleteFieldDefinition'; fieldSlug: string }
  | { type: 'createTool'; toolName: string; toolCode: string; metadata: any }
  | { type: 'modifyTool'; toolName: string; toolCode: string; metadata: any };

export type FlowModificationSet = {
  operations: FlowModificationOperation[];
  description: string;
};

export type FlowDiff = {
  before: FlowSchema;
  after: FlowSchema;
  changes: Array<{
    type: string;
    path: string;
    before?: any;
    after?: any;
  }>;
};

class FlowAgent {
  /**
   * Parses natural language instructions and generates flow modifications
   */
  async parseInstructions(
    instructions: string,
    currentFlow: FlowSchema,
  ): Promise<FlowModificationSet> {
    try {
      const systemPrompt = [
        'You are a flow modification assistant. Your job is to parse natural language instructions',
        'and generate structured flow modification operations.',
        '',
        'Available operations:',
        '- modifyPrompt: Change a stage prompt',
        '- addField: Add a field to a stage',
        '- removeField: Remove a field from a stage',
        '- reorderFields: Change the order of fields in a stage',
        '- createStage: Create a new stage',
        '- deleteStage: Delete a stage',
        '- modifyTransition: Change where a stage transitions to',
        '- addAction: Add a tool action to a stage',
        '- removeAction: Remove an action from a stage',
        '- modifyAction: Change a stage action',
        '- addFieldDefinition: Create a new field definition',
        '- modifyFieldDefinition: Update a field definition',
        '- deleteFieldDefinition: Remove a field definition',
        '- createTool: Create a new tool',
        '- modifyTool: Update an existing tool',
        '',
        'Current flow structure:',
        JSON.stringify(currentFlow, null, 2),
        '',
        'Return a JSON object with:',
        '{',
        '  "operations": [array of modification operations],',
        '  "description": "human-readable description of changes"',
        '}',
        '',
        'Be precise and only generate operations that match the instructions.',
      ].join('\n');

      const response = await llmService.generateResponse({
        conversationId: 'flow-agent',
        messageId: `agent-${Date.now()}`,
        message: instructions,
        stream: false,
        systemPrompt,
      });

      let responseText = '';
      for await (const chunk of response) {
        responseText += chunk;
      }

      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse agent response as JSON');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        operations: parsed.operations || [],
        description: parsed.description || 'Flow modifications',
      };
    } catch (error: any) {
      logger.error('Failed to parse flow modification instructions:', error);
      throw new Error(`Failed to parse instructions: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Applies modification operations to a flow
   */
  applyModifications(flow: FlowSchema, modifications: FlowModificationSet): FlowSchema {
    const modified = JSON.parse(JSON.stringify(flow)) as FlowSchema;

    for (const operation of modifications.operations) {
      try {
        switch (operation.type) {
          case 'modifyPrompt':
            if (modified.definition.stages[operation.stageSlug]) {
              modified.definition.stages[operation.stageSlug].prompt = operation.newPrompt;
            }
            break;

          case 'addField':
            if (modified.definition.stages[operation.stageSlug]) {
              const fields = modified.definition.stages[operation.stageSlug].fieldsToCollect;
              if (operation.position !== undefined) {
                fields.splice(operation.position, 0, operation.fieldSlug);
              } else {
                fields.push(operation.fieldSlug);
              }
            }
            break;

          case 'removeField':
            if (modified.definition.stages[operation.stageSlug]) {
              const fields = modified.definition.stages[operation.stageSlug].fieldsToCollect;
              const index = fields.indexOf(operation.fieldSlug);
              if (index > -1) {
                fields.splice(index, 1);
              }
            }
            break;

          case 'reorderFields':
            if (modified.definition.stages[operation.stageSlug]) {
              modified.definition.stages[operation.stageSlug].fieldsToCollect = operation.fieldOrder;
            }
            break;

          case 'createStage':
            modified.definition.stages[operation.stageSlug] = operation.stage;
            break;

          case 'deleteStage':
            delete modified.definition.stages[operation.stageSlug];
            break;

          case 'modifyTransition':
            if (modified.definition.stages[operation.stageSlug]) {
              modified.definition.stages[operation.stageSlug].nextStage = operation.nextStage;
            }
            break;

          case 'addAction':
            if (modified.definition.stages[operation.stageSlug]) {
              modified.definition.stages[operation.stageSlug].action = operation.action;
            }
            break;

          case 'removeAction':
            if (modified.definition.stages[operation.stageSlug]) {
              delete modified.definition.stages[operation.stageSlug].action;
            }
            break;

          case 'modifyAction':
            if (modified.definition.stages[operation.stageSlug]) {
              modified.definition.stages[operation.stageSlug].action = operation.action;
            }
            break;

          case 'addFieldDefinition':
            modified.definition.fields[operation.fieldSlug] = operation.field;
            break;

          case 'modifyFieldDefinition':
            if (modified.definition.fields[operation.fieldSlug]) {
              modified.definition.fields[operation.fieldSlug] = {
                ...modified.definition.fields[operation.fieldSlug],
                ...operation.field,
              };
            }
            break;

          case 'deleteFieldDefinition':
            delete modified.definition.fields[operation.fieldSlug];
            break;

          default:
            logger.warn(`Unknown operation type: ${(operation as any).type}`);
        }
      } catch (error: any) {
        logger.error(`Failed to apply operation ${operation.type}:`, error);
        throw error;
      }
    }

    return modified;
  }

  /**
   * Creates or modifies a field schema definition from natural language
   */
  async createFieldSchema(
    instructions: string,
    currentFlow: FlowSchema,
  ): Promise<{ fieldSlug: string; fieldDefinition: any }> {
    try {
      const systemPrompt = [
        'You are a field schema definition assistant. Your job is to parse natural language instructions',
        'and generate field definitions for flow forms.',
        '',
        'Available field types: string, boolean, number',
        'Available validation options: minLength, maxLength, pattern (regex), enum (array of strings)',
        '',
        'Current flow fields:',
        JSON.stringify(Object.keys(currentFlow.definition.fields), null, 2),
        '',
        'Return a JSON object with:',
        '{',
        '  "fieldSlug": "snake_case_field_name",',
        '  "fieldDefinition": {',
        '    "type": "string" | "boolean" | "number",',
        '    "description": "human-readable description",',
        '    "minLength": number (optional),',
        '    "maxLength": number (optional),',
        '    "pattern": "regex string" (optional),',
        '    "enum": ["value1", "value2"] (optional),',
        '    "sensitive": boolean (optional)',
        '  }',
        '}',
      ].join('\n');

      const response = await llmService.generateResponse({
        conversationId: 'flow-agent-schema',
        messageId: `agent-schema-${Date.now()}`,
        message: instructions,
        stream: false,
        systemPrompt,
      });

      let responseText = '';
      for await (const chunk of response) {
        responseText += chunk;
      }

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse agent response as JSON');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        fieldSlug: parsed.fieldSlug,
        fieldDefinition: parsed.fieldDefinition,
      };
    } catch (error: any) {
      logger.error('Failed to create field schema:', error);
      throw new Error(`Failed to create field schema: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Generates a diff between two flows
   */
  generateDiff(before: FlowSchema, after: FlowSchema): FlowDiff {
    const changes: FlowDiff['changes'] = [];

    // Compare stages
    const beforeStages = Object.keys(before.definition.stages);
    const afterStages = Object.keys(after.definition.stages);

    // Find added stages
    for (const stage of afterStages) {
      if (!beforeStages.includes(stage)) {
        changes.push({
          type: 'stage_added',
          path: `stages.${stage}`,
          after: after.definition.stages[stage],
        });
      }
    }

    // Find removed stages
    for (const stage of beforeStages) {
      if (!afterStages.includes(stage)) {
        changes.push({
          type: 'stage_removed',
          path: `stages.${stage}`,
          before: before.definition.stages[stage],
        });
      }
    }

    // Find modified stages
    for (const stage of beforeStages) {
      if (afterStages.includes(stage)) {
        const beforeStage = before.definition.stages[stage];
        const afterStage = after.definition.stages[stage];

        if (JSON.stringify(beforeStage.prompt) !== JSON.stringify(afterStage.prompt)) {
          changes.push({
            type: 'prompt_modified',
            path: `stages.${stage}.prompt`,
            before: beforeStage.prompt,
            after: afterStage.prompt,
          });
        }

        if (JSON.stringify(beforeStage.fieldsToCollect) !== JSON.stringify(afterStage.fieldsToCollect)) {
          changes.push({
            type: 'fields_modified',
            path: `stages.${stage}.fieldsToCollect`,
            before: beforeStage.fieldsToCollect,
            after: afterStage.fieldsToCollect,
          });
        }

        if (JSON.stringify(beforeStage.nextStage) !== JSON.stringify(afterStage.nextStage)) {
          changes.push({
            type: 'transition_modified',
            path: `stages.${stage}.nextStage`,
            before: beforeStage.nextStage,
            after: afterStage.nextStage,
          });
        }

        if (JSON.stringify(beforeStage.action) !== JSON.stringify(afterStage.action)) {
          changes.push({
            type: 'action_modified',
            path: `stages.${stage}.action`,
            before: beforeStage.action,
            after: afterStage.action,
          });
        }
      }
    }

    // Compare fields
    const beforeFields = Object.keys(before.definition.fields);
    const afterFields = Object.keys(after.definition.fields);

    for (const field of afterFields) {
      if (!beforeFields.includes(field)) {
        changes.push({
          type: 'field_added',
          path: `fields.${field}`,
          after: after.definition.fields[field],
        });
      } else if (JSON.stringify(before.definition.fields[field]) !== JSON.stringify(after.definition.fields[field])) {
        changes.push({
          type: 'field_modified',
          path: `fields.${field}`,
          before: before.definition.fields[field],
          after: after.definition.fields[field],
        });
      }
    }

    for (const field of beforeFields) {
      if (!afterFields.includes(field)) {
        changes.push({
          type: 'field_removed',
          path: `fields.${field}`,
          before: before.definition.fields[field],
        });
      }
    }

    return {
      before,
      after,
      changes,
    };
  }
}

export const flowAgent = new FlowAgent();
