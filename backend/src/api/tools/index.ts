import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { flowAgent } from '../../lib/flowEngine/flowAgent';
import { registerDynamicTool, executeTool } from '../../lib/flowEngine/tools';
import type { ToolExecutionContext } from '../../lib/flowEngine/tools/types';

registerRoute('get', '/api/v1/tools', async (req, res) => {
  try {
    const builtInTools = [
      { id: 'choco.signup', name: 'choco.signup', description: 'Choco signup tool', builtIn: true },
      { id: 'choco.setup-organisation', name: 'choco.setup-organisation', description: 'Choco setup organisation tool', builtIn: true },
      { id: 'nonprofit.lookup', name: 'nonprofit.lookup', description: 'Nonprofit lookup tool', builtIn: true },
    ];

    const dynamicTools = await prisma.tool.findMany({
      select: { id: true, name: true, description: true, metadata: true, createdAt: true, updatedAt: true },
    });

    res.json({
      ok: true,
      tools: [
        ...builtInTools,
        ...dynamicTools.map((t: any) => ({ ...t, builtIn: false })),
      ],
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to get tools',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('get', '/api/v1/tools/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return res.status(404).json({ ok: false, error: 'Tool not found' });
    }

    res.json({ ok: true, tool });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to get tool',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('post', '/api/v1/tools', async (req, res) => {
  try {
    const { instructions, name, description } = req.body as {
      instructions?: string;
      name?: string;
      description?: string;
    };

    let toolName = name;
    let toolCode = '';
    let toolMetadata: any = {};

    if (instructions) {
      // Use agent to generate tool code
      const systemPrompt = [
        'You are a tool creation assistant. Your job is to parse natural language instructions',
        'and generate JavaScript/TypeScript code for a tool executor function.',
        '',
        'The tool executor should:',
        '1. Accept a payload (any type) and context (with conversationId)',
        '2. Return a Promise<ToolResult> where ToolResult = { success: boolean, data?: any, error?: string, saveResults?: Record<string, any> }',
        '3. If saveResults is provided, those fields will be automatically saved to userData',
        '',
        'Return a JSON object with:',
        '{',
        '  "name": "tool.name",',
        '  "code": "async function executor(payload, context) { ... }",',
        '  "description": "Tool description",',
        '  "metadata": {',
        '    "parameters": { ... },',
        '    "returnType": "...",',
        '  }',
        '}',
      ].join('\n');

      // For now, use a simple approach - in production, would use LLM
      toolName = name || `custom.tool.${Date.now()}`;
      toolCode = `async function executor(payload, context) {
  // TODO: Implement tool logic based on: ${instructions}
  return {
    success: true,
    data: {},
    saveResults: {} // Optional: fields to save to userData
  };
}`;
      toolMetadata = {
        description: description || instructions,
        parameters: {},
        returnType: 'any',
      };
    } else if (name) {
      return res.status(400).json({ ok: false, error: 'Tool code or instructions required' });
    } else {
      return res.status(400).json({ ok: false, error: 'Name or instructions required' });
    }

    const tool = await prisma.tool.create({
      data: {
        name: toolName,
        description: toolMetadata.description || description || '',
        code: toolCode,
        metadata: toolMetadata as any,
      },
    });

    // Register tool
    await registerDynamicTool(toolName, async (payload: any, context: ToolExecutionContext) => {
      const { executeDynamicTool } = await import('../../lib/flowEngine/tools/dynamicToolExecutor');
      return executeDynamicTool(toolCode, payload, context);
    }, toolMetadata);

    res.json({ ok: true, tool });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to create tool',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('put', '/api/v1/tools/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, code, metadata } = req.body as {
      name?: string;
      description?: string;
      code?: string;
      metadata?: any;
    };

    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return res.status(404).json({ ok: false, error: 'Tool not found' });
    }

    const updated = await prisma.tool.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(code !== undefined && { code }),
        ...(metadata !== undefined && { metadata: metadata as any }),
      },
    });

    // Re-register tool
    if (updated.code) {
      await registerDynamicTool(updated.name, async (payload: any, context: ToolExecutionContext) => {
        const { executeDynamicTool } = await import('../../lib/flowEngine/tools/dynamicToolExecutor');
        return executeDynamicTool(updated.code, payload, context);
      }, updated.metadata as any);
    }

    res.json({ ok: true, tool: updated });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to update tool',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('delete', '/api/v1/tools/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return res.status(404).json({ ok: false, error: 'Tool not found' });
    }

    await prisma.tool.delete({ where: { id } });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to delete tool',
      message: error?.message,
    });
  }
}, { protected: true });

registerRoute('post', '/api/v1/tools/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const { payload } = req.body as { payload?: any };

    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return res.status(404).json({ ok: false, error: 'Tool not found' });
    }

    const result = await executeTool(tool.name, payload || {}, { conversationId: 'test' });

    res.json({ ok: true, result });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to test tool',
      message: error?.message,
    });
  }
}, { protected: true });
