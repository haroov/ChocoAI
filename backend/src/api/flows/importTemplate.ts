import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { getAvailableTemplates, getTemplateBySlug, importTemplate } from '../../lib/flowEngine/flowTemplates';
import { validateFlowSchemaPayload } from './helpers/validateFlowSchemaPayload';

registerRoute('get', '/api/v1/flows/templates', async (req, res) => {
  try {
    const templates = getAvailableTemplates();
    res.json({
      ok: true,
      templates: templates.map((t) => ({
        name: t.name,
        slug: t.slug,
        description: t.description,
      })),
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to get templates',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('post', '/api/v1/flows/import-template', async (req, res) => {
  try {
    const { templateSlug, newSlug, overwrite } = req.body as {
      templateSlug: string;
      newSlug?: string;
      overwrite?: boolean;
    };

    if (!templateSlug) {
      return res.status(400).json({ ok: false, error: 'Template slug is required' });
    }

    const template = getTemplateBySlug(templateSlug);
    if (!template) {
      return res.status(404).json({ ok: false, error: 'Template not found' });
    }

    const finalSlug = newSlug || template.slug;

    // Check if flow with this slug already exists
    const existing = await prisma.flow.findUnique({ where: { slug: finalSlug } });
    if (existing && !overwrite) {
      return res.status(409).json({
        ok: false,
        error: 'Flow with this slug already exists',
        existingFlowId: existing.id,
      });
    }

    // Import template
    const importedFlow = importTemplate(template, { newSlug: finalSlug });

    // Validate
    const validation = validateFlowSchemaPayload(importedFlow);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, error: validation.error });
    }

    if (existing && overwrite) {
      // Update existing flow
      const updated = await prisma.flow.update({
        where: { id: existing.id },
        data: {
          name: importedFlow.name,
          slug: importedFlow.slug,
          version: existing.version + 1,
          description: importedFlow.description,
          definition: importedFlow.definition as any,
        },
      });
      return res.json({ ok: true, flow: updated, imported: true });
    }
    // Create new flow
    const created = await prisma.flow.create({
      data: {
        name: importedFlow.name,
        slug: importedFlow.slug,
        version: importedFlow.version,
        description: importedFlow.description,
        definition: importedFlow.definition as any,
      },
    });
    return res.json({ ok: true, flow: created, imported: true });

  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to import template',
      message: error?.message,
    });
  }
}, { protected: true });
