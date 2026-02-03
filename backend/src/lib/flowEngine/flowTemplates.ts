import { FlowSchema } from './types';
import { signUpFlowSchema } from './builtInFlows/signUp';
import { kycFlowSchema } from './builtInFlows/kyc';
import { campaignManagementFlowSchema } from './builtInFlows/campaignManagement';

export type FlowTemplate = {
  name: string;
  slug: string;
  description: string;
  schema: FlowSchema;
};

const templates: FlowTemplate[] = [
  {
    name: signUpFlowSchema.name,
    slug: signUpFlowSchema.slug,
    description: signUpFlowSchema.description,
    schema: signUpFlowSchema,
  },
  {
    name: kycFlowSchema.name,
    slug: kycFlowSchema.slug,
    description: kycFlowSchema.description,
    schema: kycFlowSchema,
  },
  {
    name: campaignManagementFlowSchema.name,
    slug: campaignManagementFlowSchema.slug,
    description: campaignManagementFlowSchema.description,
    schema: campaignManagementFlowSchema,
  },
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
