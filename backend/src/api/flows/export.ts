import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';

registerRoute('get', '/api/v1/flows/export', async (req, res) => {
  try {
    const { id, slug } = req.query as { id?: string; slug?: string };

    if (id || slug) {
      const where: any = id ? { id } : { slug };
      const flow = await prisma.flow.findUnique({ where });
      if (!flow) return res.status(404).json({ ok: false, error: 'Flow not found' });

      const body = {
        name: flow.name,
        slug: flow.slug,
        version: flow.version,
        description: flow.description,
        ...(flow.definition as any),
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${flow.slug}.json"`);
      return res.status(200).send(JSON.stringify(body, null, 2));
    }

    const flows = await prisma.flow.findMany();
    const payload = flows.map((flow) => ({
      name: flow.name,
      slug: flow.slug,
      version: flow.version,
      description: flow.description,
      ...(flow.definition as any),
    }));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="flows-export.json"');
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to export flows', message: error?.message });
  }
}, { protected: true });
