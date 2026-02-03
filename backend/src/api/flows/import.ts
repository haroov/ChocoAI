import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { validateFlowSchemaPayload } from './helpers/validateFlowSchemaPayload';

registerRoute('post', '/api/v1/flows/import', async (req, res) => {
  try {
    const { body } = req;
    const overwrite = !!(body && typeof body === 'object' && 'overwrite' in body ? body.overwrite : false);
    const itemsRaw = Array.isArray(body) ? body : Array.isArray(body?.flows) ? body.flows : (body && body.flows == null ? body : []);

    const items: any[] = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
    const cleanItems = items.filter((x) => x && typeof x === 'object');
    if (cleanItems.length === 0) return res.status(400).json({ ok: false, error: 'No valid flow schemas provided' });
    if (cleanItems.length > 100) return res.status(400).json({ ok: false, error: 'Too many items (max 100)' });

    const results: { slug: string; action: 'created' | 'updated' | 'skipped' | 'error'; id?: string; error?: string }[] = [];

    for (const schema of cleanItems) {
      const v = validateFlowSchemaPayload(schema);
      if (!v.ok) {
        results.push({ slug: schema?.slug || '(unknown)', action: 'error', error: v.error });
        continue;
      }
      try {
        const existing = await prisma.flow.findUnique({ where: { slug: schema.slug } });
        if (existing) {
          if (!overwrite) {
            results.push({ slug: schema.slug, action: 'skipped', id: existing.id });
          } else {
            const updated = await prisma.flow.update({
              where: { id: existing.id },
              data: {
                name: schema.name,
                slug: schema.slug,
                description: schema.description,
                definition: { stages: schema.stages, fields: schema.fields, config: schema.config },
              },
            });
            results.push({ slug: updated.slug, action: 'updated', id: updated.id });
          }
        } else {
          const created = await prisma.flow.create({
            data: {
              name: schema.name,
              slug: schema.slug,
              description: schema.description,
              definition: { stages: schema.stages, fields: schema.fields, config: schema.config },
            },
          });
          results.push({ slug: created.slug, action: 'created', id: created.id });
        }
      } catch (err: any) {
        results.push({ slug: schema.slug, action: 'error', error: err?.message || 'Unknown error' });
      }
    }

    const counts = results.reduce((acc, r) => { acc[r.action] = (acc[r.action] || 0) + 1; return acc; }, {} as Record<string, number>);
    res.status(200).json({ ok: true, overwrite, results, counts });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to import flows', message: error?.message });
  }
}, { protected: true });
