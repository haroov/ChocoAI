import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { FlowSchema } from '../../lib/flowEngine';
import { flowAgent, FlowModificationSet } from '../../lib/flowEngine/flowAgent';
import { validateFlowSchemaPayload } from './helpers/validateFlowSchemaPayload';

registerRoute('post', '/api/v1/flows/:id/agent/apply', async (req, res) => {
  try {
    const { id } = req.params;
    const { modifications, saveAsDraft } = req.body as {
      modifications: FlowModificationSet;
      saveAsDraft?: boolean;
    };

    if (!modifications) {
      return res.status(400).json({ ok: false, error: 'Modifications are required' });
    }

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) {
      return res.status(404).json({ ok: false, error: 'Flow not found' });
    }

    const currentFlow = {
      ...flow,
      definition: flow.definition as FlowSchema['definition'],
    } as FlowSchema;

    // Apply modifications
    const modifiedFlow = flowAgent.applyModifications(currentFlow, modifications);

    // Validate the modified flow
    const validation = validateFlowSchemaPayload(modifiedFlow);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, error: validation.error });
    }

    if (saveAsDraft) {
      // Save as draft (store in flow metadata or separate draft table)
      await prisma.flow.update({
        where: { id },
        data: {
          definition: modifiedFlow.definition as any,
          // Store draft flag in metadata if needed
        },
      });
      return res.json({ ok: true, flow: modifiedFlow, draft: true });
    }
    // Save immediately with version increment
    const updated = await prisma.flow.update({
      where: { id },
      data: {
        name: modifiedFlow.name,
        slug: modifiedFlow.slug,
        version: flow.version + 1,
        description: modifiedFlow.description,
        definition: modifiedFlow.definition as any,
      },
    });

    return res.json({ ok: true, flow: updated });

  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to apply modifications',
      message: error?.message,
    });
  }
}, { protected: true });
