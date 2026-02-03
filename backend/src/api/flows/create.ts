import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { FlowSchema } from '../../lib/flowEngine';
import { validateFlowSchemaPayload } from './helpers/validateFlowSchemaPayload';

registerRoute('post', '/api/v1/flows', async (req, res) => {
  try {
    const schema = req.body as FlowSchema;
    const v = validateFlowSchemaPayload(schema);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

    const existing = await prisma.flow.findUnique({ where: { slug: schema.slug } });
    if (existing) return res.status(409).json({ ok: false, error: 'Flow with this slug already exists' });

    const flow = await prisma.flow.create({
      data: {
        name: schema.name,
        slug: schema.slug,
        version: 0,
        description: schema.description,
        definition: schema.definition,
      },
    });

    res.status(201).json({ ok: true, flow });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to create flow', message: error?.message });
  }
}, { protected: true });
