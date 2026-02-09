import { FlowSchema } from './types';

export type FlowTemplate = {
  name: string;
  slug: string;
  description: string;
  schema: FlowSchema;
};

const templates: FlowTemplate[] = [
  // Intentionally empty for now.
  // Built-in flows are automatically synced on startup from `builtInFlows/`.
];

export function getAvailableTemplates(): FlowTemplate[] {
  return templates;
}

export function getTemplateBySlug(slug: string): FlowTemplate | undefined {
  return templates.find((t) => t.slug === slug);
}

export function importTemplate(template: FlowTemplate, options?: {
  overwrite?: boolean;
  newSlug?: string;
}): FlowSchema {
  const imported = JSON.parse(JSON.stringify(template.schema)) as FlowSchema;

  if (options?.newSlug) {
    imported.slug = options.newSlug;
  }

  return imported;
}
