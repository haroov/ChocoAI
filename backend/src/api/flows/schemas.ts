import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { FlowSchema } from '../../lib/flowEngine';
import { flowAgent } from '../../lib/flowEngine/flowAgent';

registerRoute('get', '/api/v1/flows/:id/schemas', async (req, res) => {
  try {
    const { id } = req.params;
    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    const flowSchema = {
      ...flow,
      definition: flow.definition as FlowSchema['definition'],
    } as FlowSchema;

    res.json({
      ok: true,
      schemas: flowSchema.definition.fields,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to get schemas',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('post', '/api/v1/flows/:id/schemas', async (req, res) => {
  try {
    const { id } = req.params;
    const { instructions } = req.body as { instructions: string };

    if (!instructions || typeof instructions !== 'string') {
      return res.status(400).json({ ok: false, error: 'Instructions are required' });
    }

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    const currentFlow = {
      ...flow,
      definition: flow.definition as FlowSchema['definition'],
    } as FlowSchema;

    // Create field schema via agent
    const { fieldSlug, fieldDefinition } = await flowAgent.createFieldSchema(instructions, currentFlow);

    // Add to flow
    const updatedDefinition = {
      ...currentFlow.definition,
      fields: {
        ...currentFlow.definition.fields,
        [fieldSlug]: fieldDefinition,
      },
    };

    await prisma.flow.update({
      where: { id },
      data: {
        definition: updatedDefinition as any,
        version: flow.version + 1,
      },
    });

    res.json({
      ok: true,
      fieldSlug,
      fieldDefinition,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to create schema',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('put', '/api/v1/flows/:id/schemas/:fieldSlug', async (req, res) => {
  try {
    const { id, fieldSlug } = req.params;
    const { fieldDefinition } = req.body as { fieldDefinition: any };

    if (!fieldDefinition) {
      return res.status(400).json({ ok: false, error: 'Field definition is required' });
    }

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    const currentFlow = {
      ...flow,
      definition: flow.definition as FlowSchema['definition'],
    } as FlowSchema;

    if (!currentFlow.definition.fields[fieldSlug]) {
      return res.status(404).json({ ok: false, error: 'Field not found' });
    }

    // Update field definition
    const updatedDefinition = {
      ...currentFlow.definition,
      fields: {
        ...currentFlow.definition.fields,
        [fieldSlug]: { ...currentFlow.definition.fields[fieldSlug], ...fieldDefinition },
      },
    };

    await prisma.flow.update({
      where: { id },
      data: {
        definition: updatedDefinition as any,
        version: flow.version + 1,
      },
    });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to update schema',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('delete', '/api/v1/flows/:id/schemas/:fieldSlug', async (req, res) => {
  try {
    const { id, fieldSlug } = req.params;

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    const currentFlow = {
      ...flow,
      definition: flow.definition as FlowSchema['definition'],
    } as FlowSchema;

    if (!currentFlow.definition.fields[fieldSlug]) {
      return res.status(404).json({ ok: false, error: 'Field not found' });
    }

    // Remove field from definition
    const updatedFields = { ...currentFlow.definition.fields };
    delete updatedFields[fieldSlug];

    const updatedDefinition = {
      ...currentFlow.definition,
      fields: updatedFields,
    };

    await prisma.flow.update({
      where: { id },
      data: {
        definition: updatedDefinition as any,
        version: flow.version + 1,
      },
    });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to delete schema',
      message: error?.message,
    });
  }
}, { protected: true });
