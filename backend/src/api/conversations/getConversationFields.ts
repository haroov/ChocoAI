import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { maskPII } from '../../lib/__redact';
import { prisma } from '../../core';
import { validateField } from './helpers/__validateFields';
import { flowHelpers } from '../../lib/flowEngine/flowHelpers';

async function getUserDataForFlowOnly(userId: string, flowId: string | null | undefined) {
  if (!flowId) return {};
  const rows = await prisma.userData.findMany({
    where: { userId, flowId },
    select: { key: true, value: true, type: true },
  });
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    let value: unknown;
    switch (row.type) {
      case 'string': value = row.value; break;
      case 'number': value = Number(row.value); break;
      case 'boolean': value = row.value === 'true'; break;
      default: value = row.value;
    }
    out[row.key] = value;
  }
  return out;
}

registerRoute('get', '/api/v1/conversations/:id/fields', async (req: Request, res: Response) => {
  try {
    const idRaw = (req.params as any).id as unknown;
    const id = Array.isArray(idRaw) ? String(idRaw[0] || '').trim() : String(idRaw || '').trim();

    if (!id) {
      res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION', message: 'Missing conversation ID' },
      });
      return;
    }

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) {
      res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Conversation not found' },
      });
      return;
    }

    // Prefer authoritative userData from the flow engine (insurance + modern flows).
    // Fallback to legacy timelineEvent.details if userId is missing.
    let fields: Record<string, any> = {};
    if (conversation.userId) {
      const userFlow = await prisma.userFlow.findUnique({ where: { userId: conversation.userId } });
      // IMPORTANT: For the "Collected Data" panel, scope to the active flow only.
      // Merging cross-flow keys causes confusing duplicates (same value across multiple unrelated keys).
      fields = await getUserDataForFlowOnly(conversation.userId, userFlow?.flowId);
    } else {
      // Legacy fallback: pull the latest timeline event with `data.details` (if present).
      const timeline = await prisma.event.findFirst({
        where: { conversationId: conversation.id, kind: 'timeline' },
        orderBy: { createdAt: 'desc' },
      });
      fields = (timeline?.data as any)?.details || {};
    }

    const role = fields.role || 'customer';

    // Build sections
    const sections = [];

    // Insurance-style sections (customer / business / requested insurance)
    const customerFields = ['first_name', 'last_name', 'phone', 'email', 'address'];
    const businessFields = [
      'business_name',
      'legal_id_type',
      'legal_id',
      'industry',
      'activity_description',
      'annual_turnover_ils',
      'employees_count',
      'locations_count',
    ];
    const insuranceFields = ['product_line', 'coverages_needed', 'special_risks'];

    const isInsuranceConversation = customerFields.some((k) => !!fields[k])
      || businessFields.some((k) => !!fields[k])
      || insuranceFields.some((k) => !!fields[k]);

    // Legacy profile fields (donor/nonprofit) kept for backwards compatibility
    const legacyProfileFields = role === 'nonprofit'
      ? ['organization_name', 'first_name', 'last_name', 'email', 'phone']
      : ['first_name', 'last_name', 'email'];

    const countCollected = (keys: string[]) => keys.filter((key) => {
      const value = fields[key];
      if (key === 'email')
        return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
      return !!value;
    }).length;

    const buildSection = (name: string, keys: string[]) => ({
      name,
      progress: `${countCollected(keys)}/${keys.length}`,
      fields: keys.map((key) => {
        const validation = validateField(key, fields[key]);
        return {
          key,
          label: key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          value: maskPII(key, fields[key]),
          collected: !!fields[key],
          valid: validation.valid,
          reason: validation.reason,
          confidence: validation.confidence,
        };
      }),
    });

    if (isInsuranceConversation) {
      sections.push(buildSection('Customer', customerFields));
      sections.push(buildSection('Business', businessFields));
      sections.push(buildSection('Insurance Request', insuranceFields));
    } else {
      // Legacy section (donations/nonprofit)
      sections.push(buildSection('Profile Information', legacyProfileFields));
    }

    // Used for ETag caching of the fields panel.
    // Bump when the response structure/logic changes.
    const flowVersion = '1.1.0';

    // Conditional GET support
    if (req.headers['if-none-match'] === `"${flowVersion}"`) {
      res.status(304).end();
      return;
    }

    res.set('ETag', `"${flowVersion}"`);
    res.json({
      ok: true,
      sections,
      flowVersion,
      validationPolicy: {
        llmMinConfidence: 0.75,
        userMinConfidence: 1.0,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get conversation fields',
      },
    });
  }
}, { protected: true });
