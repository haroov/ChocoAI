import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { FlowSchema } from '../../lib/flowEngine';

// Store drafts in a separate table or in flow metadata
// For now, using a simple approach: store draft in flow's definition with a draft flag

registerRoute('post', '/api/v1/flows/:id/draft', async (req, res) => {
  try {
    const { id } = req.params;
    const { definition } = req.body as { definition: FlowSchema['definition'] };

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    // Store draft in a metadata field or separate table
    // For simplicity, we'll use a JSON field to store draft
    await prisma.flow.update({
      where: { id },
      data: {
        // Store draft in definition temporarily (in production, use separate draft table)
        definition: definition as any,
      },
    });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to save draft',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('get', '/api/v1/flows/:id/draft', async (req, res) => {
  try {
    const { id } = req.params;

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    // Return draft if exists (for now, just return current flow)
    // In production, check for separate draft record
    res.json({
      ok: true,
      draft: flow.definition,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to get draft',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('delete', '/api/v1/flows/:id/draft', async (req, res) => {
  try {
    const { id } = req.params;

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    // Discard draft (in production, delete draft record)
    // For now, just return success
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to discard draft',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('post', '/api/v1/flows/:id/draft/apply', async (req, res) => {
  try {
    const { id } = req.params;

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    // Apply draft (in production, copy draft to flow and increment version)
    const updated = await prisma.flow.update({
      where: { id },
      data: {
        version: flow.version + 1,
        // Draft is already in definition, just increment version
      },
    });

    res.json({ ok: true, flow: updated });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to apply draft',
      message: error?.message,
    });
  }
}, { protected: true });
