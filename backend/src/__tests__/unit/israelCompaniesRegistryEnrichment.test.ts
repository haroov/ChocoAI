jest.mock('../../lib/services/gateways/israelCompaniesRegistry', () => ({
  lookupIsraelCompanyByNumber: jest.fn(),
}));

import { enrichIsraelCompaniesRegistryInPlace } from '../../lib/flowEngine/israelCompaniesRegistryEnrichment';
import { lookupIsraelCompanyByNumber } from '../../lib/services/gateways/israelCompaniesRegistry';

describe('israelCompaniesRegistryEnrichment', () => {
  test('enrichIsraelCompaniesRegistryInPlace fills extra registrar fields and red-flags violators', async () => {
    (lookupIsraelCompanyByNumber as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      company: {
        companyNumber: '510000011',
        nameHe: 'אולימפיה אוטו בע~מ',
        statusHe: 'פעילה',
        incorporationDate: '13/09/1936',
        descriptionHe: 'תיאור לדוגמה',
        purposeHe: 'לעסוק בסוגי עיסוק שפורטו בתקנון',
        governmentCompanyHe: 'לא',
        limitationsHe: 'מוגבלת',
        violatorHe: 'מפרה',
        violatorCode: 18,
        lastAnnualReportYear: 2015,
        city: 'תל אביב - יפו',
        street: 'הירקון',
        houseNumber: '325',
        zip: '6350454',
        poBox: '123',
        country: 'ישראל',
        statusCode: 0,
      },
    });

    const validatedCollectedData: Record<string, unknown> = {
      business_registration_id: '510000011',
      business_legal_entity_type: 'חברה פרטית',
      business_name: 'אולימפיה אוטו',
    };
    const existingUserData: Record<string, unknown> = {};

    await enrichIsraelCompaniesRegistryInPlace({
      validatedCollectedData,
      existingUserData,
      conversationId: 'conv_1',
    });

    expect(validatedCollectedData.il_company_number).toBe('510000011');
    expect(validatedCollectedData.il_companies_registry_description_he).toBe('תיאור לדוגמה');
    expect(validatedCollectedData.il_companies_registry_purpose_he).toBe('לעסוק בסוגי עיסוק שפורטו בתקנון');
    expect(validatedCollectedData.il_companies_registry_is_violator).toBe(true);
    expect(validatedCollectedData.business_po_box).toBe('123');
    expect(validatedCollectedData.business_country).toBe('ישראל');

    const hasFlags = validatedCollectedData.il_companies_registry_red_flags as unknown;
    expect(hasFlags).toBe(true);

    const reasons = validatedCollectedData.il_companies_registry_red_flag_reasons as unknown;
    expect(Array.isArray(reasons)).toBe(true);
    if (!Array.isArray(reasons)) throw new Error('Expected reasons array');
    expect(reasons).toContain('company_is_violator');
  });
});

