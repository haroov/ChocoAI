import { FlowDiff } from '../../../lib/flowEngine/flowAgent';
import { FlowSchema } from '../../../lib/flowEngine';

/**
 * Generates a human-readable diff description
 */
export function generateHumanReadableDiff(diff: FlowDiff): string {
  const lines: string[] = [];

  for (const change of diff.changes) {
    switch (change.type) {
      case 'stage_added':
        lines.push(`+ Added stage: ${change.path}`);
        break;
      case 'stage_removed':
        lines.push(`- Removed stage: ${change.path}`);
        break;
      case 'prompt_modified':
        lines.push(`~ Modified prompt in ${change.path}`);
        lines.push(`  Before: ${JSON.stringify(change.before).substring(0, 100)}...`);
        lines.push(`  After: ${JSON.stringify(change.after).substring(0, 100)}...`);
        break;
      case 'fields_modified':
        lines.push(`~ Modified fields in ${change.path}`);
        lines.push(`  Before: [${(change.before as string[]).join(', ')}]`);
        lines.push(`  After: [${(change.after as string[]).join(', ')}]`);
        break;
      case 'transition_modified':
        lines.push(`~ Modified transition in ${change.path}`);
        break;
      case 'action_modified':
        lines.push(`~ Modified action in ${change.path}`);
        break;
      case 'field_added':
        lines.push(`+ Added field: ${change.path}`);
        break;
      case 'field_modified':
        lines.push(`~ Modified field: ${change.path}`);
        break;
      case 'field_removed':
        lines.push(`- Removed field: ${change.path}`);
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Checks if changes are breaking (affect existing conversations)
 */
export function isBreakingChange(diff: FlowDiff): boolean {
  // Removing stages or fields that might be in use
  return diff.changes.some((change) =>
    change.type === 'stage_removed' ||
    change.type === 'field_removed' ||
    (change.type === 'field_modified' && change.before && change.after),
  );
}
