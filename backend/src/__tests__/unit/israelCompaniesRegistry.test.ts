jest.mock('../../lib/services/httpService', () => ({
  httpService: {
    get: jest.fn(),
  },
}));

import { httpService } from '../../lib/services/httpService';
import { lookupIsraelCompanyByNumber } from '../../lib/services/gateways/israelCompaniesRegistry';

describe('israelCompaniesRegistry gateway', () => {
  test('lookupIsraelCompanyByNumber maps Companies Registrar record fields', async () => {
    const json = {
      success: true,
      result: {
        records: [
          {
            'מספר חברה': 510000011,
            'שם חברה': 'אולימפיה אוטו בע~מ',
            'שם באנגלית': '',
            'סוג תאגיד': 'ישראלית חברה פרטית',
            'סטטוס חברה': 'פעילה',
            'תאור חברה': 'תיאור לדוגמה',
            'מטרת החברה': 'לעסוק בסוגי עיסוק שפורטו בתקנון',
            'תאריך התאגדות': '13/09/1936',
            'חברה ממשלתית': 'לא',
            'מגבלות': 'מוגבלת',
            'מפרה': 'מפרה',
            'שנה אחרונה של דוח שנתי (שהוגש)': 2015,
            'שם עיר': 'תל אביב - יפו',
            'שם רחוב': 'הירקון',
            'מספר בית': '325',
            מיקוד: 6350454,
            'ת.ד.': '123',
            מדינה: 'ישראל',
            אצל: '',
            'תת סטטוס': '',
            'קוד סטטוס חברה': 0,
            'קוד סוג חברה': 1,
            'קוד סיווג חברה': 51,
            'קוד מטרת החברה': 3,
            'קוד מגבלה': 1,
            'קוד חברה מפרה': 18,
            'קוד ישוב': 5000,
            'קוד רחוב': 461,
            'קוד מדינה': 376,
          },
        ],
      },
    };

    (httpService.get as unknown as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await lookupIsraelCompanyByNumber('510000011', 'conv_1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.company.companyNumber).toBe('510000011');
    expect(res.company.nameHe).toBe('אולימפיה אוטו בע~מ');
    expect(res.company.statusHe).toBe('פעילה');
    expect(res.company.descriptionHe).toBe('תיאור לדוגמה');
    expect(res.company.purposeHe).toBe('לעסוק בסוגי עיסוק שפורטו בתקנון');
    expect(res.company.governmentCompanyHe).toBe('לא');
    expect(res.company.limitationsHe).toBe('מוגבלת');
    expect(res.company.violatorHe).toBe('מפרה');
    expect(res.company.lastAnnualReportYear).toBe(2015);
    expect(res.company.poBox).toBe('123');
    expect(res.company.country).toBe('ישראל');
    expect(res.company.statusCode).toBe(0);
    expect(res.company.violatorCode).toBe(18);
  });

  test('lookupIsraelCompanyByNumber returns not_found when no record exists', async () => {
    const json = { success: true, result: { records: [] } };
    (httpService.get as unknown as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await lookupIsraelCompanyByNumber('510000011', 'conv_1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not_found');
  });

  test('lookupIsraelCompanyByNumber rejects too-short inputs', async () => {
    const res = await lookupIsraelCompanyByNumber('123', 'conv_1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('invalid_company_number');
  });
});

