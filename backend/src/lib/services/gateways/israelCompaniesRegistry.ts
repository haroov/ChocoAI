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
  city?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
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

  const company: IsraelCompanyLookup = {
    companyNumber,
    nameHe: typeof record['שם חברה'] === 'string' ? (record['שם חברה'] as string) : undefined,
    nameEn: typeof record['שם באנגלית'] === 'string' ? (record['שם באנגלית'] as string) : undefined,
    corporationTypeHe: typeof record['סוג תאגיד'] === 'string' ? (record['סוג תאגיד'] as string) : undefined,
    statusHe: typeof record['סטטוס חברה'] === 'string' ? (record['סטטוס חברה'] as string) : undefined,
    incorporationDate: typeof record['תאריך התאגדות'] === 'string' ? (record['תאריך התאגדות'] as string) : undefined,
    city: typeof record['שם עיר'] === 'string' ? (record['שם עיר'] as string) : undefined,
    street: typeof record['שם רחוב'] === 'string' ? (record['שם רחוב'] as string) : undefined,
    houseNumber: typeof record['מספר בית'] === 'string' || typeof record['מספר בית'] === 'number'
      ? String(record['מספר בית'])
      : undefined,
    zip: typeof record['מיקוד'] === 'string' || typeof record['מיקוד'] === 'number'
      ? String(record['מיקוד'])
      : undefined,
    rawRecord: record,
  };

  return { ok: true, company };
}
