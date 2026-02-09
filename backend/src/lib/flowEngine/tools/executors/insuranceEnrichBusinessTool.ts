import { prisma } from '../../../../core';
import { lookupIsraelCompanyByNumber } from '../../../services/gateways/israelCompaniesRegistry';
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

function legalIdTypeToHeLabel(t: 'HP' | 'AM' | 'TZ' | 'EIN'): string {
  switch (t) {
    case 'HP': return 'מספר חברה';
    case 'AM': return 'עוסק מורשה';
    case 'TZ': return 'ת"ז';
    case 'EIN': return 'EIN';
    default: return String(t);
  }
}

function mapCompanyCorporationTypeToLegalEntityType(corporationTypeHe?: string): string | undefined {
  const s = String(corporationTypeHe || '').trim();
  if (!s) return undefined;

  // Examples from the dataset:
  // "ישראלית חברה פרטית", "ישראלית חברה ציבורית", "שותפות רשומה" (may vary)
  if (/פרטית/.test(s)) return 'private_company';
  if (/ציבורית/.test(s)) return 'public_company';
  if (/שותפ/.test(s)) return 'registered_partnership';
  return 'other';
}

/**
 * insurance.enrichBusiness
 * Enriches Israeli business details from external sources based on legal identifiers.
 *
 * Currently:
 * - If legal_id_type === HP (ח"פ): lookup via data.gov.il Companies Registrar dataset and auto-fill address + legal name.
 * - If legal_id_type === AM (ע"מ / עוסק מורשה): auto-set business_legal_entity_type to "authorized_dealer" (if missing).
 *
 * This tool is meant to run silently inside the insurance flows after identifyCustomer.
 */
export const insuranceEnrichBusinessTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation?.userId) {
      return { success: false, error: 'Conversation or user not found', errorCode: 'CONVERSATION_NOT_FOUND' };
    }

    const legalIdType = normalizeLegalIdType(payload.legal_id_type);
    const legalIdDigits = String(payload.legal_id || '').replace(/\D/g, '');
    const businessName = String(payload.business_name || '').trim();
    const currentLegalEntityType = String(payload.business_legal_entity_type || '').trim();

    const saveResults: Record<string, unknown> = {};

    // Normalize stored legal_id_type to a human Hebrew label for UI/UX (keep tools compatible via normalization)
    if (legalIdType) {
      saveResults.legal_id_type = legalIdTypeToHeLabel(legalIdType);
      saveResults.legal_id_type_code = legalIdType;
    }

    // AM (ע"מ / עוסק מורשה) → authorized_dealer (internal enum in proposalForm)
    if (legalIdType === 'AM' && !currentLegalEntityType) {
      saveResults.business_legal_entity_type = 'authorized_dealer';
      saveResults.business_legal_entity_type_source = 'legal_id_type_am';
    }

    // HP (ח"פ) → enrich from registrar
    if (legalIdType === 'HP' && legalIdDigits) {
      const lookup = await lookupIsraelCompanyByNumber(legalIdDigits, conversationId);
      if (lookup.ok) {
        const c = lookup.company;

        // Store raw reference fields
        saveResults.il_company_number = c.companyNumber;
        saveResults.business_registry_source = 'data.gov.il:companies';

        if (c.statusHe) saveResults.business_registry_status_he = c.statusHe;
        if (c.incorporationDate) saveResults.business_incorporation_date = c.incorporationDate;
        if (c.corporationTypeHe) saveResults.business_corporation_type_he = c.corporationTypeHe;

        // Prefer not overwriting user-provided display/trade name, but store legal name separately.
        if (c.nameHe) {
          saveResults.business_legal_name = c.nameHe;
          if (!businessName) saveResults.business_name = c.nameHe;
        }

        // Address fields used by proposal form mapping
        if (c.city) saveResults.business_city = c.city;
        if (c.street) saveResults.business_street = c.street;
        if (c.houseNumber) saveResults.business_house_number = c.houseNumber;
        if (c.zip) saveResults.business_zip = c.zip;

        // Map corporation type → internal enum (if not already set)
        if (!currentLegalEntityType) {
          const mapped = mapCompanyCorporationTypeToLegalEntityType(c.corporationTypeHe);
          if (mapped) {
            saveResults.business_legal_entity_type = mapped;
            saveResults.business_legal_entity_type_source = 'companies_registry';
          }
        }
      } else {
        // Not found is not fatal — user can continue manually.
        saveResults.business_registry_lookup = lookup.reason;
      }
    }

    return {
      success: true,
      data: { enriched: Object.keys(saveResults).length > 0 },
      saveResults: Object.keys(saveResults).length > 0 ? saveResults : undefined,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to enrich business' };
  }
};
