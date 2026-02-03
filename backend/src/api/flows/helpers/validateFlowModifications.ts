import { FlowSchema, FlowDefinition } from '../../../lib/flowEngine';
import { FlowModificationSet } from '../../../lib/flowEngine/flowAgent';

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Validates flow modifications to ensure the flow remains valid
 */
export function validateFlowModifications(
  originalFlow: FlowSchema,
  modifications: FlowModificationSet,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for stage references
  const stageSlugs = new Set(Object.keys(originalFlow.definition.stages));
  const fieldSlugs = new Set(Object.keys(originalFlow.definition.fields));

  for (const operation of modifications.operations) {
    switch (operation.type) {
      case 'modifyPrompt':
      case 'addField':
      case 'removeField':
      case 'reorderFields':
      case 'modifyTransition':
      case 'addAction':
      case 'removeAction':
      case 'modifyAction':
        if (!stageSlugs.has(operation.stageSlug)) {
          errors.push(`Stage "${operation.stageSlug}" does not exist`);
        }
        // For addField, also check if the field exists
        if (operation.type === 'addField' && !fieldSlugs.has(operation.fieldSlug)) {
          errors.push(`Field "${operation.fieldSlug}" is not defined in flow fields`);
        }
        break;

      case 'createStage':
        if (stageSlugs.has(operation.stageSlug)) {
          warnings.push(`Stage "${operation.stageSlug}" already exists and will be overwritten`);
        }
        break;

      case 'addFieldDefinition':
        if (fieldSlugs.has(operation.fieldSlug)) {
          warnings.push(`Field "${operation.fieldSlug}" already exists and will be overwritten`);
        }
        break;

      case 'modifyFieldDefinition':
      case 'deleteFieldDefinition':
        if (!fieldSlugs.has(operation.fieldSlug)) {
          errors.push(`Field "${operation.fieldSlug}" does not exist`);
        }
        break;
    }
  }

  // Check for circular dependencies in transitions
  // This would be done after applying modifications, but we can warn here

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
