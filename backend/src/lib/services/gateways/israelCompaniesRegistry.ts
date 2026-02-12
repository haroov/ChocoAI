import { httpService } from '../httpService';

const IL_COMPANIES_RESOURCE_ID = 'f004176c-b85f-4542-8901-7b3176f9a054';

type CkanDatastoreSearchResponse = {
  success: boolean;
  result?: {
    records?: Array<Record<string, unknown>>;
  };
  error?: unknown;
};

export type IsraelCompanyLookup = {
  companyNumber: string;
  nameHe?: string;
  nameEn?: string;
  corporationTypeHe?: string;
  statusHe?: string;
  incorporationDate?: string;
  descriptionHe?: string;
  purposeHe?: string;
  governmentCompanyHe?: string;
  limitationsHe?: string;
  violatorHe?: string;
  lastAnnualReportYear?: number;
  city?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
  poBox?: string;
  country?: string;
  careOf?: string;
  subStatusHe?: string;
  statusCode?: number;
  companyTypeCode?: number;
  classificationCode?: number;
  purposeCode?: number;
  limitationCode?: number;
  violatorCode?: number;
  cityCode?: number;
  streetCode?: number;
  countryCode?: number;
  rawRecord?: Record<string, unknown>;
};

export type IsraelCompanyLookupResult =
  | { ok: true; company: IsraelCompanyLookup }
  | { ok: false; reason: 'invalid_company_number' | 'not_found' | 'http_error' | 'parse_error'; details?: unknown };

function normalizeCompanyNumber(input: string): string {
  const digits = String(input || '').replace(/\D/g, '');
  return digits;
}

/**
 * Lookup an Israeli company (ח"פ) via data.gov.il (Companies Registrar dataset).
 *
 * Dataset fields are Hebrew strings (e.g., "מספר חברה", "שם חברה", "שם עיר").
 * We normalize them into an English-friendly shape.
 */
export async function lookupIsraelCompanyByNumber(
  companyNumberInput: string,
  conversationId: string,
): Promise<IsraelCompanyLookupResult> {
  const companyNumber = normalizeCompanyNumber(companyNumberInput);

  // Israeli company numbers are typically 8-9 digits. Be permissive but reject OTP-like values.
  if (companyNumber.length < 7) {
    return { ok: false, reason: 'invalid_company_number', details: { companyNumberInput } };
  }

  const companyNumberAsNumber = Number(companyNumber);
  if (!Number.isFinite(companyNumberAsNumber)) {
    return { ok: false, reason: 'invalid_company_number', details: { companyNumberInput } };
  }

  const filters = encodeURIComponent(JSON.stringify({ 'מספר חברה': companyNumberAsNumber }));
  const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${IL_COMPANIES_RESOURCE_ID}&filters=${filters}&limit=1`;

  let res: Response;
  try {
    res = await httpService.get(url, {
      conversationId,
      providerName: 'data.gov.il',
      operationName: 'Israel Companies Registry lookup (ח"פ)',
    });
  } catch (e) {
    return { ok: false, reason: 'http_error', details: e };
  }

  let json: CkanDatastoreSearchResponse;
  try {
    json = (await res.json()) as CkanDatastoreSearchResponse;
  } catch (e) {
    return { ok: false, reason: 'parse_error', details: e };
  }

  if (!res.ok || !json?.success) {
    return {
      ok: false,
      reason: 'http_error',
      details: { status: res.status, statusText: res.statusText, body: json },
    };
  }

  const record = json.result?.records?.[0];
  if (!record) return { ok: false, reason: 'not_found', details: { companyNumber } };

  const pickNum = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
    return Number.isFinite(n) ? n : undefined;
  };

  const company: IsraelCompanyLookup = {
    companyNumber,
    nameHe: typeof record['שם חברה'] === 'string' ? (record['שם חברה'] as string) : undefined,
    nameEn: typeof record['שם באנגלית'] === 'string' ? (record['שם באנגלית'] as string) : undefined,
    corporationTypeHe: typeof record['סוג תאגיד'] === 'string' ? (record['סוג תאגיד'] as string) : undefined,
    statusHe: typeof record['סטטוס חברה'] === 'string' ? (record['סטטוס חברה'] as string) : undefined,
    descriptionHe: typeof record['תאור חברה'] === 'string' ? (record['תאור חברה'] as string) : undefined,
    purposeHe: typeof record['מטרת החברה'] === 'string' ? (record['מטרת החברה'] as string) : undefined,
    incorporationDate: typeof record['תאריך התאגדות'] === 'string' ? (record['תאריך התאגדות'] as string) : undefined,
    governmentCompanyHe: typeof record['חברה ממשלתית'] === 'string' ? (record['חברה ממשלתית'] as string) : undefined,
    limitationsHe: typeof record['מגבלות'] === 'string' ? (record['מגבלות'] as string) : undefined,
    violatorHe: typeof record['מפרה'] === 'string' ? (record['מפרה'] as string) : undefined,
    lastAnnualReportYear: (() => {
      const n = pickNum(record['שנה אחרונה של דוח שנתי (שהוגש)']);
      if (n === undefined) return undefined;
      const y = Math.trunc(n);
      return y > 1900 && y < 2200 ? y : undefined;
    })(),
    city: typeof record['שם עיר'] === 'string' ? (record['שם עיר'] as string) : undefined,
    street: typeof record['שם רחוב'] === 'string' ? (record['שם רחוב'] as string) : undefined,
    houseNumber: typeof record['מספר בית'] === 'string' || typeof record['מספר בית'] === 'number'
      ? String(record['מספר בית'])
      : undefined,
    zip: typeof record['מיקוד'] === 'string' || typeof record['מיקוד'] === 'number'
      ? String(record['מיקוד'])
      : undefined,
    poBox: typeof record['ת.ד.'] === 'string' || typeof record['ת.ד.'] === 'number'
      ? String(record['ת.ד.'])
      : undefined,
    country: typeof record['מדינה'] === 'string' ? (record['מדינה'] as string) : undefined,
    careOf: typeof record['אצל'] === 'string' ? (record['אצל'] as string) : undefined,
    subStatusHe: typeof record['תת סטטוס'] === 'string' ? (record['תת סטטוס'] as string) : undefined,
    statusCode: pickNum(record['קוד סטטוס חברה']),
    companyTypeCode: pickNum(record['קוד סוג חברה']),
    classificationCode: pickNum(record['קוד סיווג חברה']),
    purposeCode: pickNum(record['קוד מטרת החברה']),
    limitationCode: pickNum(record['קוד מגבלה']),
    violatorCode: pickNum(record['קוד חברה מפרה']),
    cityCode: pickNum(record['קוד ישוב']),
    streetCode: pickNum(record['קוד רחוב']),
    countryCode: pickNum(record['קוד מדינה']),
    rawRecord: record,
  };

  return { ok: true, company };
}
