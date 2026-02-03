import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { FlowSchema } from '../../lib/flowEngine';
import { flowAgent } from '../../lib/flowEngine/flowAgent';
import { validateFlowSchemaPayload } from './helpers/validateFlowSchemaPayload';

registerRoute('post', '/api/v1/flows/:id/agent', async (req, res) => {
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

    // Parse instructions and generate modifications
    const modifications = await flowAgent.parseInstructions(instructions, currentFlow);

    // Apply modifications to create preview
    const modifiedFlow = flowAgent.applyModifications(currentFlow, modifications);

    // Generate diff
    const diff = flowAgent.generateDiff(currentFlow, modifiedFlow);

    res.json({
      ok: true,
      modifications,
      preview: modifiedFlow,
      diff,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to process agent instructions',
      message: error?.message,
    });
  }
}, { protected: true });
