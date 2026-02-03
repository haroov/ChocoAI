import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { FlowSchema } from '../../lib/flowEngine';
import { validateFlowSchemaPayload } from './helpers/validateFlowSchemaPayload';

registerRoute('put', '/api/v1/flows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const schema = req.body as FlowSchema;
    const v = validateFlowSchemaPayload(schema);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

    // Ensure slug uniqueness if changed
    const current = await prisma.flow.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ ok: false, error: 'Flow not found' });
    if (current.slug !== schema.slug) {
      const dup = await prisma.flow.findUnique({ where: { slug: schema.slug } });
      if (dup) return res.status(409).json({ ok: false, error: 'Another flow with this slug exists' });
    }

    const flow = await prisma.flow.update({
      where: { id },
      data: {
        name: schema.name,
        slug: schema.slug,
        version: schema.version + 1,
        description: schema.description,
        definition: schema.definition,
      },
    });

    res.json({ ok: true, flow });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to update flow', message: error?.message });
  }
}, { protected: true });
