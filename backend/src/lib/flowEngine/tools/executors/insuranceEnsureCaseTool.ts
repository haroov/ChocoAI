import { prisma } from '../../../../core';
import { ToolExecutor, ToolResult } from '../types';

function normalizeLegalIdType(v: unknown): 'HP' | 'AM' | 'TZ' | 'EIN' | null {
  const raw = String(v || '').trim().toUpperCase();
  if (raw === 'HP') return 'HP';
  if (raw === 'AM') return 'AM';
  if (raw === 'TZ') return 'TZ';
  if (raw === 'EIN') return 'EIN';

  // Hebrew aliases (common)
  if (raw.includes('ח')) return 'HP';
  if (raw.includes('ע')) return 'AM';
  if (raw.includes('ת')) return 'TZ';
  return null;
}

/**
 * insurance.ensureCase
 * Creates or attaches:
 * - Customer (business) by legal id
 * - CustomerUser link
 * - InsuranceCase for this conversation (default carrier: clal)
 *
 * Saves identifiers to userData via saveResults.
 */
export const insuranceEnsureCaseTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });
    if (!conversation?.userId) {
      return { success: false, error: 'Conversation or user not found', errorCode: 'CONVERSATION_NOT_FOUND' };
    }

    const businessName = String(payload.business_name || '').trim();
    const legalIdType = normalizeLegalIdType(payload.legal_id_type);
    const legalId = String(payload.legal_id || '').trim();
    const country = 'IL';

    if (!legalIdType || !legalId) {
      return {
        success: false,
        error: 'Missing legal id type or legal id',
        errorCode: 'MISSING_LEGAL_ID',
      };
    }

    // Ensure carrier exists (MVP default: clal)
    const carrierSlug = String(payload.carrier_slug || 'clal').trim().toLowerCase();
    const carrier = await prisma.insuranceCarrier.upsert({
      where: { slug: carrierSlug },
      update: {},
      create: {
        slug: carrierSlug,
        name: carrierSlug === 'clal' ? 'Clal' : carrierSlug,
        contactEmails: [],
      },
      select: { id: true, slug: true },
    });

    const customer = await prisma.customer.upsert({
      where: {
        legalIdType_legalId_country: {
          legalIdType,
          legalId,
          country,
        },
      },
      update: {
        displayName: businessName || `Business ${legalId}`,
      },
      create: {
        displayName: businessName || `Business ${legalId}`,
        legalIdType,
        legalId,
        country,
      },
      select: { id: true },
    });

    await prisma.customerUser.upsert({
      where: {
        customerId_userId: {
          customerId: customer.id,
          userId: conversation.userId,
        },
      },
      update: { accessRole: 'owner' },
      create: {
        customerId: customer.id,
        userId: conversation.userId,
        accessRole: 'owner',
      },
    });

    // Reuse an existing case for this conversation if available; otherwise create a new one.
    const existing = await prisma.insuranceCase.findFirst({
      where: {
        conversationId,
        customerId: customer.id,
        carrierId: carrier.id,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const insuranceCase = existing
      ? await prisma.insuranceCase.update({
        where: { id: existing.id },
        data: { status: 'collectingInfo' },
        select: { id: true },
      })
      : await prisma.insuranceCase.create({
        data: {
          customerId: customer.id,
          carrierId: carrier.id,
          status: 'collectingInfo',
          summary: 'Quote started via ChocoAI flow',
          conversationId,
          createdByUserId: conversation.userId,
        },
        select: { id: true },
      });

    return {
      success: true,
      data: {
        caseId: insuranceCase.id,
        customerId: customer.id,
        carrierSlug: carrier.slug,
      },
      saveResults: {
        insurance_case_id: insuranceCase.id,
        insurance_customer_id: customer.id,
        insurance_carrier_slug: carrier.slug,
      },
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to ensure insurance case' };
  }
};
