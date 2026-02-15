import { lookupIsraelCompanyByNumber } from '../services/gateways/israelCompaniesRegistry';

function digitsOnly(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function parseYearFromDdMmYyyy(dateRaw: unknown): number | null {
  const s = String(dateRaw ?? '').trim();
  if (!s) return null;
  // Common in data.gov.il dataset: "13/09/1936"
  const m = /(\d{4})\s*$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

function parseDdMmYyyyToIso(dateRaw: unknown): string | null {
  const s = String(dateRaw ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return null;
  if (yyyy < 1800 || yyyy > 2200) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${String(yyyy).padStart(4, '0')}-${pad2(mm)}-${pad2(dd)}`;
}

function parseLastAnnualReportYearFromRawRecord(rawRecord?: Record<string, unknown> | null): number | null {
  if (!rawRecord) return null;
  // Dataset field (Hebrew): "שנה אחרונה של דוח שנתי (שהוגש)"
  const v = (rawRecord as any)['שנה אחרונה של דוח שנתי (שהוגש)'];
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) return null;
  const y = Math.trunc(n);
  return y > 1900 && y < 2200 ? y : null;
}

function parseYesNoHe(v: unknown): boolean | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s === 'כן') return true;
  if (s === 'לא') return false;
  return null;
}

function parseIsViolatorHe(violatorHe: unknown, violatorCode: unknown): boolean | null {
  const s = String(violatorHe ?? '').trim();
  if (s) {
    // Typical values: "מפרה" / "לא מפרה"
    if (/לא/.test(s) && /מפרה/.test(s)) return false;
    if (/מפרה/.test(s)) return true;
  }
  const code = typeof violatorCode === 'number' ? violatorCode : Number(String(violatorCode ?? '').trim());
  if (Number.isFinite(code)) return code > 0;
  return null;
}

function normalizeCompanyName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”"׳״'’`´~]/g, '')
    .replace(/[\u200f\u200e]/g, '') // bidi marks
    .replace(/[\(\)\[\]\{\}\.,;:!?\\/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Common suffixes / legal designators (Hebrew + English)
    .replace(/\s+(בעמ|בעמ\.|בעמ,|במ|ltd|limited|inc|llc|corp|corporation|co)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeName(norm: string): string[] {
  const words = norm
    .split(/\s+/)
    .map((w) => w.replace(/[^\u0590-\u05FFa-z0-9]/g, '').trim())
    .filter(Boolean);

  // Drop ultra-common noise tokens
  const stop = new Set(['ה', 'ו', 'של', 'the', 'and', 'of', 'co', 'company']);
  return words.filter((w) => w.length >= 2 && !stop.has(w));
}

function computeNameMatchConfidence(userProvidedName: string, registryName: string): number {
  const a0 = normalizeCompanyName(userProvidedName);
  const b0 = normalizeCompanyName(registryName);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 1;
  if ((a0.length >= 4 && b0.includes(a0)) || (b0.length >= 4 && a0.includes(b0))) return 0.9;

  const a = new Set(tokenizeName(a0));
  const b = new Set(tokenizeName(b0));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  if (union <= 0) return 0;

  // Jaccard similarity on tokens (0..1)
  return inter / union;
}

function isActiveStatusHe(statusHe: string): boolean {
  const s = String(statusHe ?? '').trim();
  if (!s) return false;
  // Dataset commonly uses "פעילה" / "פעיל"
  return /פעיל/.test(s);
}

/**
 * Enrich Israeli private/public company info (ח"פ / ח"צ) from Companies Registrar dataset.
 *
 * - Logs the external API call into Conversation "API Log" via httpService.
 * - Stores extracted fields into validatedCollectedData so they persist into conversation collected data (userData).
 */
export async function enrichIsraelCompaniesRegistryInPlace(params: {
  validatedCollectedData: Record<string, unknown>;
  existingUserData: Record<string, unknown>;
  conversationId?: string;
}): Promise<void> {
  const { validatedCollectedData, existingUserData } = params;

  const conversationId = String(params.conversationId || '').trim();
  if (!conversationId) return;

  const regIdDigits = digitsOnly(validatedCollectedData.business_registration_id ?? existingUserData.business_registration_id);
  if (!regIdDigits) return;

  // Only meaningful for company numbers. Most Israeli companies are 5xxxxxxxx.
  // Keep it strict to avoid looking up AM/TZ-like identifiers.
  if (!/^5\d{7,8}$/.test(regIdDigits)) return;

  const entityTypeRaw = String(
    validatedCollectedData.business_legal_entity_type ?? existingUserData.business_legal_entity_type ?? '',
  ).trim();
  const isCompanyType = entityTypeRaw === 'חברה פרטית' || entityTypeRaw === 'חברה ציבורית';

  // If the user hasn't answered entity type yet, we still allow enrichment based on the ID prefix (51/52).
  const inferredCompanyTypeFromId = regIdDigits.startsWith('51') || regIdDigits.startsWith('52');
  if (!isCompanyType && !inferredCompanyTypeFromId) return;

  // Idempotency: if we already enriched for this exact company number, skip.
  try {
    const prevCompanyNumber = digitsOnly((existingUserData as any).il_company_number);
    const hasPrevSignals = isPresent((existingUserData as any).il_companies_registry_status_he)
      || isPresent((existingUserData as any).il_companies_registry_last_annual_report_year)
      || isPresent((existingUserData as any).business_registry_status_he);

    // If we already enriched, only skip when we don't need to backfill newly-added fields.
    const needsBackfill = !isPresent((existingUserData as any).il_companies_registry_incorporation_date)
      || !isPresent((existingUserData as any).il_companies_registry_name_en)
      || !isPresent((existingUserData as any).il_companies_registry_name_he);

    if (prevCompanyNumber && prevCompanyNumber === regIdDigits && hasPrevSignals && !needsBackfill) return;
  } catch {
    // best-effort
  }

  const lookup = await lookupIsraelCompanyByNumber(regIdDigits, conversationId);
  if (!lookup.ok) {
    // Keep a small marker for observability (optional for UI/debug).
    validatedCollectedData.il_companies_registry_lookup = lookup.reason;
    return;
  }

  const c = lookup.company;
  const rawRecord = c.rawRecord || null;

  const nameHe = String(c.nameHe || '').trim();
  const nameEn = String(c.nameEn || '').trim();
  const statusHe = String(c.statusHe || '').trim();

  const incorporationYear = parseYearFromDdMmYyyy(c.incorporationDate);
  const incorporationDateIso = parseDdMmYyyyToIso(c.incorporationDate);
  const lastAnnualReportYear = typeof c.lastAnnualReportYear === 'number'
    ? c.lastAnnualReportYear
    : parseLastAnnualReportYearFromRawRecord(rawRecord);

  if (nameHe) validatedCollectedData.il_companies_registry_name_he = nameHe;
  if (nameEn) validatedCollectedData.il_companies_registry_name_en = nameEn;
  if (incorporationDateIso) validatedCollectedData.il_companies_registry_incorporation_date = incorporationDateIso;
  if (typeof incorporationYear === 'number') validatedCollectedData.il_companies_registry_incorporation_year = incorporationYear;
  if (typeof lastAnnualReportYear === 'number') {
    validatedCollectedData.il_companies_registry_last_annual_report_year = lastAnnualReportYear;
  }
  if (statusHe) validatedCollectedData.il_companies_registry_status_he = statusHe;
  if (typeof c.statusCode === 'number') validatedCollectedData.il_companies_registry_status_code = c.statusCode;
  if (typeof c.companyTypeCode === 'number') validatedCollectedData.il_companies_registry_company_type_code = c.companyTypeCode;
  if (typeof c.classificationCode === 'number') validatedCollectedData.il_companies_registry_classification_code = c.classificationCode;
  if (typeof c.purposeCode === 'number') validatedCollectedData.il_companies_registry_purpose_code = c.purposeCode;
  if (typeof c.limitationCode === 'number') validatedCollectedData.il_companies_registry_limitation_code = c.limitationCode;
  if (typeof c.violatorCode === 'number') validatedCollectedData.il_companies_registry_violator_code = c.violatorCode;
  if (typeof c.cityCode === 'number') validatedCollectedData.il_companies_registry_city_code = c.cityCode;
  if (typeof c.streetCode === 'number') validatedCollectedData.il_companies_registry_street_code = c.streetCode;
  if (typeof c.countryCode === 'number') validatedCollectedData.il_companies_registry_country_code = c.countryCode;

  const purposeHe = String(c.purposeHe || '').trim();
  if (purposeHe) validatedCollectedData.il_companies_registry_purpose_he = purposeHe;
  const descHe = String(c.descriptionHe || '').trim();
  if (descHe) validatedCollectedData.il_companies_registry_description_he = descHe;

  const gov = parseYesNoHe(c.governmentCompanyHe);
  if (gov !== null) validatedCollectedData.il_companies_registry_is_government_company = gov;
  const limitationsHe = String(c.limitationsHe || '').trim();
  if (limitationsHe) validatedCollectedData.il_companies_registry_limitations_he = limitationsHe;
  const violatorHe = String(c.violatorHe || '').trim();
  if (violatorHe) validatedCollectedData.il_companies_registry_violator_he = violatorHe;
  const subStatusHe = String(c.subStatusHe || '').trim();
  if (subStatusHe) validatedCollectedData.il_companies_registry_sub_status_he = subStatusHe;

  // Compatibility / linkage keys (used elsewhere in the system).
  validatedCollectedData.il_company_number = c.companyNumber;
  validatedCollectedData.business_registry_source = 'data.gov.il:companies';

  // Store the legal name separately; do not override user-provided trade name.
  if (nameHe) validatedCollectedData.business_legal_name = nameHe;

  // Address from registrar (best-effort).
  // IMPORTANT: do NOT auto-fill the user's business_* address fields from the registry.
  // We store it as a suggestion for observability / potential future UX, but the user must provide/confirm address explicitly.
  const hasAny = (k: string): boolean => isPresent((validatedCollectedData as any)[k]) || isPresent((existingUserData as any)[k]);
  const hasUserEnteredAddress = hasAny('business_user_entered_city')
    || hasAny('business_user_entered_street')
    || hasAny('business_user_entered_house_number')
    || hasAny('business_user_entered_full_address');

  if (!hasUserEnteredAddress) {
    if (!hasAny('business_registry_suggested_city') && c.city) validatedCollectedData.business_registry_suggested_city = c.city;
    if (!hasAny('business_registry_suggested_street') && c.street) validatedCollectedData.business_registry_suggested_street = c.street;
    if (!hasAny('business_registry_suggested_house_number') && c.houseNumber) validatedCollectedData.business_registry_suggested_house_number = c.houseNumber;
    if (!hasAny('business_registry_suggested_zip') && c.zip) validatedCollectedData.business_registry_suggested_zip = c.zip;
    if (!hasAny('business_country') && c.country) validatedCollectedData.business_country = c.country;
    if (!hasAny('business_po_box')) {
      const po = String(c.poBox ?? '').trim();
      const digits = po.replace(/\D/g, '');
      if (digits && digits.length <= 7) validatedCollectedData.business_po_box = digits;
    }

    const suggestedFull = `${String(c.street || '').trim()} ${String(c.houseNumber || '').trim()}, ${String(c.city || '').trim()}`.replace(/\s+/g, ' ').replace(/^,|,$/g, '').trim();
    if (!hasAny('business_registry_suggested_full_address') && suggestedFull) {
      validatedCollectedData.business_registry_suggested_full_address = suggestedFull;
    }
  }

  // Name match vs. user-provided business_name
  const userBusinessName = String(validatedCollectedData.business_name ?? existingUserData.business_name ?? '').trim();
  let nameMatchConfidence: number | null = null;
  if (userBusinessName && nameHe) {
    const confidence = computeNameMatchConfidence(userBusinessName, nameHe);
    nameMatchConfidence = confidence;
    validatedCollectedData.il_companies_registry_name_match_confidence = confidence;
    validatedCollectedData.il_companies_registry_name_match_ok = confidence >= 0.7;
    validatedCollectedData.il_companies_registry_name_match_should_verify = confidence < 0.7;
  }

  // Red flags (reasons) + overall boolean flag (requested)
  const redFlagReasons: string[] = [];
  const isActive = isActiveStatusHe(statusHe);
  validatedCollectedData.il_companies_registry_is_active = isActive;
  if (!isActive) redFlagReasons.push('company_not_active');

  const isViolator = parseIsViolatorHe(c.violatorHe, c.violatorCode);
  if (isViolator !== null) validatedCollectedData.il_companies_registry_is_violator = isViolator;
  if (isViolator) redFlagReasons.push('company_is_violator');

  const isPublicCompany = entityTypeRaw === 'חברה ציבורית' || regIdDigits.startsWith('52');

  const currentYear = new Date().getFullYear();
  if (isPublicCompany) {
    // NOTE: Public companies typically report to the stock exchange, not the Companies Registrar.
    // Therefore, "annual report recency" is treated as not applicable and should NOT raise a red flag.
    validatedCollectedData.il_companies_registry_reports_recent_not_applicable = true;
    if (typeof lastAnnualReportYear === 'number') {
      validatedCollectedData.il_companies_registry_reports_recent_ok = lastAnnualReportYear >= (currentYear - 2);
    } else {
      // Avoid false red flags; keep UX deterministic.
      validatedCollectedData.il_companies_registry_reports_recent_ok = true;
    }
  } else if (typeof lastAnnualReportYear === 'number') {
    const reportsRecentOk = lastAnnualReportYear >= (currentYear - 2);
    validatedCollectedData.il_companies_registry_reports_recent_ok = reportsRecentOk;
    if (!reportsRecentOk) redFlagReasons.push('annual_report_not_recent');
  } else {
    validatedCollectedData.il_companies_registry_reports_recent_ok = false;
    redFlagReasons.push('annual_report_year_missing');
  }

  // Requested rules for Israeli LTD company numbers (5X...):
  // - If name match confidence < 0.7 => red flag
  // - If status is not exactly "פעילה" => red flag
  const isLtdCompanyNumber = /^5\d{7,8}$/.test(regIdDigits);
  if (isLtdCompanyNumber) {
    if (typeof nameMatchConfidence === 'number' && nameMatchConfidence < 0.7) {
      redFlagReasons.push('name_mismatch');
    }
    const statusExact = String(statusHe || '').trim();
    if (statusExact && statusExact !== 'פעילה') {
      redFlagReasons.push('company_status_not_active');
    }
  }

  validatedCollectedData.il_companies_registry_red_flags = redFlagReasons.length > 0;
  validatedCollectedData.il_companies_registry_red_flag_reasons = redFlagReasons;
}
