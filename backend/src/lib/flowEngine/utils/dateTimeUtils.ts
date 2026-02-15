// @hebcal/core is ESM-only, use dynamic import
import { prisma } from '../../../core/prisma';
import { OrganisationRegion, GuidestarOrganisation, USAOrganisation } from '../../../types/kycOrganisation';

/**
 * Maps city names to timezone identifiers
 * This is a simplified mapping - in production, you might want to use a more comprehensive library
 */
const cityToTimezone: Record<string, string> = {
  // Israeli cities
  jerusalem: 'Asia/Jerusalem',
  'tel aviv': 'Asia/Jerusalem',
  'tel-aviv': 'Asia/Jerusalem',
  haifa: 'Asia/Jerusalem',
  'beer sheva': 'Asia/Jerusalem',
  beersheba: 'Asia/Jerusalem',
  eilat: 'Asia/Jerusalem',
  netanya: 'Asia/Jerusalem',
  ashdod: 'Asia/Jerusalem',
  'rishon lezion': 'Asia/Jerusalem',
  'petah tikva': 'Asia/Jerusalem',
  'ramat gan': 'Asia/Jerusalem',
  'bnei brak': 'Asia/Jerusalem',
  holon: 'Asia/Jerusalem',
  'bat yam': 'Asia/Jerusalem',
  rehovot: 'Asia/Jerusalem',
  herzliya: 'Asia/Jerusalem',
  'kfar saba': 'Asia/Jerusalem',
  raanana: 'Asia/Jerusalem',
  modiin: 'Asia/Jerusalem',
  lod: 'Asia/Jerusalem',
  ramla: 'Asia/Jerusalem',
  nahariya: 'Asia/Jerusalem',
  acre: 'Asia/Jerusalem',
  tiberias: 'Asia/Jerusalem',
  safed: 'Asia/Jerusalem',
  nazareth: 'Asia/Jerusalem',

  // US cities (major ones)
  'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  chicago: 'America/Chicago',
  houston: 'America/Chicago',
  phoenix: 'America/Phoenix',
  philadelphia: 'America/New_York',
  'san antonio': 'America/Chicago',
  'san diego': 'America/Los_Angeles',
  dallas: 'America/Chicago',
  'san jose': 'America/Los_Angeles',
  austin: 'America/Chicago',
  jacksonville: 'America/New_York',
  'san francisco': 'America/Los_Angeles',
  indianapolis: 'America/New_York',
  columbus: 'America/New_York',
  'fort worth': 'America/Chicago',
  charlotte: 'America/New_York',
  seattle: 'America/Los_Angeles',
  denver: 'America/Denver',
  washington: 'America/New_York',
  boston: 'America/New_York',
  'el paso': 'America/Denver',
  detroit: 'America/New_York',
  nashville: 'America/Chicago',
  portland: 'America/Los_Angeles',
  'oklahoma city': 'America/Chicago',
  'las vegas': 'America/Los_Angeles',
  memphis: 'America/Chicago',
  louisville: 'America/New_York',
  baltimore: 'America/New_York',
  milwaukee: 'America/Chicago',
  albuquerque: 'America/Denver',
  tucson: 'America/Phoenix',
  fresno: 'America/Los_Angeles',
  sacramento: 'America/Los_Angeles',
  'kansas city': 'America/Chicago',
  mesa: 'America/Phoenix',
  atlanta: 'America/New_York',
  omaha: 'America/Chicago',
  'colorado springs': 'America/Denver',
  raleigh: 'America/New_York',
  'virginia beach': 'America/New_York',
  miami: 'America/New_York',
  oakland: 'America/Los_Angeles',
  minneapolis: 'America/Chicago',
  tulsa: 'America/Chicago',
  cleveland: 'America/New_York',
  wichita: 'America/Chicago',
  arlington: 'America/Chicago',
};

/**
 * Gets timezone from organization data based on city
 */
function getTimezoneFromCity(city: string | null | undefined, region?: OrganisationRegion): string {
  if (!city) {
    // Default based on region
    return region === OrganisationRegion.USA ? 'America/New_York' : 'Asia/Jerusalem';
  }

  const cityLower = city.toLowerCase().trim();
  const timezone = cityToTimezone[cityLower];

  if (timezone) {
    return timezone;
  }

  // Default based on region if city not found
  return region === OrganisationRegion.USA ? 'America/New_York' : 'Asia/Jerusalem';
}

/**
 * Gets timezone for a user based on conversation channel and organization data
 */
export async function getUserTimezone(
  conversationId: string,
  channel: 'web' | 'whatsapp',
  clientTimezone?: string,
): Promise<string> {
  // If web widget and client timezone provided, use it
  if (channel === 'web' && clientTimezone) {
    return clientTimezone;
  }

  // Otherwise, get from organization data
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        user: {
          include: {
            UserOrganisation: {
              include: {
                organisation: true,
              },
            },
          },
        },
      },
    });

    if (conversation?.userId && conversation.user?.UserOrganisation?.[0]?.organisation) {
      const orgData = conversation.user.UserOrganisation[0].organisation.data as GuidestarOrganisation | USAOrganisation;
      const { region } = conversation.user.UserOrganisation[0].organisation;

      // Try to get city from organization data
      const city = (orgData as USAOrganisation).city
        || (orgData as GuidestarOrganisation).addressCity
        || undefined;

      return getTimezoneFromCity(city, region as OrganisationRegion);
    }
  } catch (error) {
    // Fallback to default
  }

  // Default fallback
  return 'UTC';
}

/**
 * Maps Hebrew calendar month names to @hebcal/core English month names
 * HDate constructor requires: new HDate(day, monthName, year)
 */
const hebrewCalendarMonths: Record<string, string> = {
  תשרי: 'Tishrei',
  חשוון: 'Cheshvan', חשון: 'Cheshvan',
  כסלו: 'Kislev', כסליו: 'Kislev',
  טבת: 'Tevet',
  שבט: 'Shevat',
  אדר: 'Adar', 'אדר א': 'Adar', 'אדר א׳': 'Adar',
  'אדר ב': 'Adar II', 'אדר ב׳': 'Adar II',
  ניסן: 'Nisan',
  אייר: 'Iyar', איר: 'Iyar',
  סיוון: 'Sivan', סיון: 'Sivan',
  תמוז: 'Tammuz',
  אב: 'Av',
  אלול: 'Elul',
};

/**
 * Checks if a date falls on Shabbat or a Jewish holiday
 */
export async function isShabbatOrHoliday(date: Date): Promise<{ isShabbatOrHoliday: boolean; eventName?: string }> {
  try {
    // Dynamic import for ESM-only package
    const { HDate, HebrewCalendar, flags } = await import('@hebcal/core');
    const hDate = new HDate(date);
    const dayOfWeek = date.getDay();

    // Check if Shabbat (Saturday)
    if (dayOfWeek === 6) {
      return { isShabbatOrHoliday: true, eventName: 'Shabbat' };
    }

    // Check for holidays
    const events = HebrewCalendar.getHolidaysOnDate(hDate);
    if (events && Array.isArray(events) && events.length > 0) {
      // Filter out minor events (Rosh Chodesh), focus on major holidays
      // Check if event has getFlags method (some versions use mask property)
      const majorEvents = events.filter((e) => {
        try {
          // Try getFlags first (newer API)
          if (typeof e.getFlags === 'function') {
            const eventFlags = e.getFlags();
            // Exclude Rosh Chodesh (minor holiday)
            return (eventFlags & flags.ROSH_CHODESH) === 0;
          }
          // Fallback: check mask property (older API) or just include all holidays
          // For now, include all holidays - better to warn than miss
          return true;
        } catch {
          // If error checking flags, include it (better safe than sorry)
          return true;
        }
      });

      if (majorEvents.length > 0) {
        // Get the description - try getDesc() method
        let eventName = 'Jewish Holiday';
        try {
          if (typeof majorEvents[0].getDesc === 'function') {
            eventName = majorEvents[0].getDesc();
          } else if (majorEvents[0].desc) {
            eventName = majorEvents[0].desc;
          }
        } catch {
          // Use default
        }
        return { isShabbatOrHoliday: true, eventName };
      }
    }

    return { isShabbatOrHoliday: false };
  } catch (error) {
    // If error parsing Hebrew date, return false (not a Hebrew calendar date)
    return { isShabbatOrHoliday: false };
  }
}

/**
 * Converts Hebrew calendar date to Gregorian date
 */
async function parseHebrewCalendarDate(
  monthName: string,
  day?: number,
  hebrewYear?: number,
): Promise<Date | null> {
  try {
    // Dynamic import for ESM-only package
    const { HDate } = await import('@hebcal/core');
    const englishMonthName = hebrewCalendarMonths[monthName];
    if (!englishMonthName) {
      return null;
    }

    // Default to 15th of month if day not specified
    const dayNum = day || 15;

    // If Hebrew year not specified, use current Hebrew year
    let hYear = hebrewYear;
    if (!hYear) {
      const currentHDate = new HDate();
      hYear = currentHDate.getFullYear();

      // Determine if month has passed - compare Hebrew calendar months
      const currentMonthName = currentHDate.getMonthName();
      const monthOrder: string[] = ['Tishrei', 'Cheshvan', 'Kislev', 'Tevet', 'Shevat', 'Adar', 'Adar II', 'Nisan', 'Iyar', 'Sivan', 'Tammuz', 'Av', 'Elul'];
      const currentMonthIndex = monthOrder.indexOf(currentMonthName);
      const targetMonthIndex = monthOrder.indexOf(englishMonthName);

      // If target month has passed in current year, use next year
      if (targetMonthIndex !== -1 && currentMonthIndex !== -1) {
        if (targetMonthIndex < currentMonthIndex || (targetMonthIndex === currentMonthIndex && dayNum < currentHDate.getDate())) {
          hYear = hYear + 1;
        }
      } else if (targetMonthIndex === -1) {
        // If we can't find the month, default to next year to be safe
        hYear = hYear + 1;
      }
    }

    // HDate constructor: new HDate(day, monthName, year)
    const hDate = new HDate(dayNum, englishMonthName, hYear);
    const gregDate = hDate.greg();

    // Validate that the conversion produced a reasonable year (between 1900-2100)
    const gregYear = gregDate.getFullYear();
    if (gregYear < 1900 || gregYear > 2100) {
      // If year is out of range, the conversion likely failed
      // This can happen with the wrong constructor signature
      return null;
    }

    return gregDate;
  } catch (error) {
    // Conversion failed - return null to trigger validation
    return null;
  }
}

/**
 * Parses a date string and formats it as ISO 8601 with timezone
 * Handles vague dates like "january 2026" by guessing beginning/middle/end of month
 * Now supports precise Hebrew calendar conversion
 */
export async function formatCampaignDate(
  dateInput: string | null | undefined,
  timezone: string = 'UTC',
): Promise<string> {
  if (!dateInput || !dateInput.trim()) {
    return '';
  }

  const input = dateInput.trim();
  const inputLower = input.toLowerCase();

  // Try to parse as ISO date first
  const isoDate = new Date(input);
  if (!isNaN(isoDate.getTime()) && input.match(/^\d{4}-\d{2}-\d{2}/)) {
    // Valid ISO date, set to beginning of day in the specified timezone
    return formatDateWithTimezone(isoDate, timezone, '00:00:00');
  }

  // Try to parse Hebrew calendar dates first (precise conversion)
  const hebrewCalendarDate = await parseHebrewCalendarDateFromString(input);
  if (hebrewCalendarDate) {
    return formatDateWithTimezone(hebrewCalendarDate, timezone, '09:00:00');
  }

  // Try to parse common date formats (Gregorian)
  const parsedDate = parseDate(input, timezone);
  if (parsedDate) {
    return formatDateWithTimezone(parsedDate, timezone, '09:00:00'); // Default to 9 AM UTC
  }

  // If parsing fails, return empty string
  return '';
}

function isValidIsoYmd(s: string): boolean {
  const v = String(s ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function ymdFromDateInTimezone(date: Date, timezone: string): string | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (!y || !m || !d) return null;
    const ymd = `${y}-${m}-${d}`;
    return isValidIsoYmd(ymd) ? ymd : null;
  } catch {
    return null;
  }
}

function addDaysToYmd(ymd: string, days: number): string | null {
  if (!isValidIsoYmd(ymd)) return null;
  if (!Number.isFinite(days)) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const out = `${y}-${m}-${dd}`;
  return isValidIsoYmd(out) ? out : null;
}

function weekdayIndexInTimezone(ymd: string, timezone: string): number | null {
  if (!isValidIsoYmd(ymd)) return null;
  try {
    // Noon UTC avoids DST edge cases (still the same local date).
    const dt = new Date(`${ymd}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    const w = fmt.format(dt).toLowerCase(); // sun/mon/tue/...
    const map: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };
    return map[w] ?? null;
  } catch {
    return null;
  }
}

function toIsoYmd(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || (dt.getUTCMonth() + 1) !== m || dt.getUTCDate() !== d) return null;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function daysInMonthUtc(y: number, m: number): number | null {
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  // Day 0 of next month = last day of current month.
  const dt = new Date(Date.UTC(y, m, 0));
  const d = dt.getUTCDate();
  return Number.isFinite(d) ? d : null;
}

function endOfMonthYmd(ymd: string): string | null {
  if (!isValidIsoYmd(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const dim = daysInMonthUtc(y, m);
  return dim ? toIsoYmd(y, m, dim) : null;
}

function addMonthsToYmd(ymd: string, months: number): string | null {
  if (!isValidIsoYmd(ymd)) return null;
  if (!Number.isFinite(months)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  const base = (y * 12) + (m - 1);
  const target = base + Math.trunc(months);
  const ty = Math.floor(target / 12);
  const tm0 = target % 12;
  const tm = tm0 + 1;
  return toIsoYmd(ty, tm, 1);
}

/**
 * Derive policy end date from a policy start date (YYYY-MM-DD).
 *
 * Business rule:
 * - The market convention is an annual policy that ends on the end-of-month closest to (start + 12 months).
 * - Operationalized as:
 *   - If start day is 1..15: end-of-month of (start + 11 months)  (month *before* the anniversary month)
 *   - If start day is 16..31: end-of-month of (start + 12 months) (anniversary month)
 */
export function derivePolicyEndDateFromStartYmd(startYmd: string): string | null {
  if (!isValidIsoYmd(startYmd)) return null;
  const day = Number(startYmd.slice(8, 10));
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  const monthsToAdd = day >= 16 ? 12 : 11;
  const firstOfTargetMonth = addMonthsToYmd(startYmd, monthsToAdd);
  if (!firstOfTargetMonth) return null;
  return endOfMonthYmd(firstOfTargetMonth);
}

/**
 * Parse user-provided policy start date text and normalize it to YYYY-MM-DD.
 *
 * Rules:
 * - min: today (in the provided timezone)
 * - max: today + 45 days (in the provided timezone)
 * - If invalid/out-of-range, return null (caller should re-ask).
 */
export async function parsePolicyStartDateToYmd(
  dateInput: string | null | undefined,
  timezone: string = 'Asia/Jerusalem',
): Promise<string | null> {
  const raw = String(dateInput ?? '').trim();
  if (!raw) return null;

  const todayYmd = ymdFromDateInTimezone(new Date(), timezone);
  if (!todayYmd) return null;
  const maxYmd = addDaysToYmd(todayYmd, 45);
  if (!maxYmd) return null;

  const inRange = (ymd: string): boolean => (
    isValidIsoYmd(ymd) && ymd >= todayYmd && ymd <= maxYmd
  );

  // Hebrew: "תחילת החודש הבא/הקרוב" -> first day of next month.
  // Examples: "תחילת החודש הבא", "בתחילת החודש הבא".
  {
    const s = raw.replace(/^[\s"“”'׳״]+|[\s"“”'׳״]+$/g, '').trim();
    const m = s.match(/^(?:ב)?תחילת\s+החודש\s+(הבא|הקרוב)$/);
    if (m) {
      const y = Number(todayYmd.slice(0, 4));
      const mon = Number(todayYmd.slice(5, 7));
      const nextMon = mon === 12 ? 1 : (mon + 1);
      const nextY = mon === 12 ? (y + 1) : y;
      const ymd = toIsoYmd(nextY, nextMon, 1);
      return ymd && inRange(ymd) ? ymd : null;
    }
  }

  // Hebrew: "אמצע החודש הבא/הקרוב" -> 15th of next month.
  // Examples: "אמצע החודש הבא", "באמצע החודש הבא".
  {
    const s = raw.replace(/^[\s"“”'׳״]+|[\s"“”'׳״]+$/g, '').trim();
    const m = s.match(/^(?:ב)?אמצע\s+החודש\s+(הבא|הקרוב)$/);
    if (m) {
      const y = Number(todayYmd.slice(0, 4));
      const mon = Number(todayYmd.slice(5, 7));
      const nextMon = mon === 12 ? 1 : (mon + 1);
      const nextY = mon === 12 ? (y + 1) : y;
      const ymd = toIsoYmd(nextY, nextMon, 15);
      return ymd && inRange(ymd) ? ymd : null;
    }
  }

  // Hebrew: "תחילת השבוע הבא/הקרוב" -> next week start (Israel: Sunday).
  // Example (today Wed 2026-02-11): "תחילת השבוע הבא" -> Sun 2026-02-15.
  {
    const s = raw.replace(/^[\s"“”'׳״]+|[\s"“”'׳״]+$/g, '').trim();
    const m = s.match(/^(?:ב)?תחילת\s+(?:השבוע|שבוע)\s+(הבא|הקרוב)$/);
    if (m) {
      const wd = weekdayIndexInTimezone(todayYmd, timezone);
      if (wd === null) return null;
      // Sunday=0. "Next week" start should always be the NEXT Sunday (>= 1 day ahead).
      const daysUntilNextSunday = wd === 0 ? 7 : (7 - wd);
      const ymd = addDaysToYmd(todayYmd, daysUntilNextSunday);
      return ymd && inRange(ymd) ? ymd : null;
    }
  }

  // Direct ISO
  if (isValidIsoYmd(raw)) {
    return inRange(raw) ? raw : null;
  }

  const token = raw.toLowerCase().trim();
  if (token === 'today' || token === 'היום') {
    return inRange(todayYmd) ? todayYmd : null;
  }
  if (token === 'tomorrow' || token === 'מחר' || token === 'ממחר') {
    const t = addDaysToYmd(todayYmd, 1);
    return t && inRange(t) ? t : null;
  }
  if (token === 'day after tomorrow' || token === 'מחרתיים') {
    const t = addDaysToYmd(todayYmd, 2);
    return t && inRange(t) ? t : null;
  }

  // dd/mm[/yyyy] (Israel default)
  // If year omitted and date is before today, roll forward to next year.
  {
    const m = raw.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?\s*$/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const yearRaw = m[3];
      const yearProvided = Boolean(yearRaw);

      const tzYear = Number(todayYmd.slice(0, 4));
      let year = yearProvided ? Number(yearRaw) : tzYear;
      if (yearProvided && String(yearRaw).length === 2) year = 2000 + Number(yearRaw);

      let iso = toIsoYmd(year, month, day);
      if (!iso) return null;

      if (!yearProvided && iso < todayYmd) {
        iso = toIsoYmd(year + 1, month, day);
      }
      return iso && inRange(iso) ? iso : null;
    }
  }

  // dd <monthNameHe> [yyyy]
  {
    const monthNamesHe: Record<string, number> = {
      'ינואר': 1,
      'פברואר': 2,
      'מרץ': 3,
      'אפריל': 4,
      'מאי': 5,
      'יוני': 6,
      'יולי': 7,
      'אוגוסט': 8,
      'ספטמבר': 9,
      'אוקטובר': 10,
      'נובמבר': 11,
      'דצמבר': 12,
    };
    const m = raw.match(/^(\d{1,2})\s*(?:ב|ל)?\s*(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)(?:\s*(\d{2,4}))?\s*$/);
    if (m) {
      const day = Number(m[1]);
      const month = monthNamesHe[m[2]] || 0;
      const yearRaw = m[3];
      const yearProvided = Boolean(yearRaw);

      const tzYear = Number(todayYmd.slice(0, 4));
      let year = yearProvided ? Number(yearRaw) : tzYear;
      if (yearProvided && String(yearRaw).length === 2) year = 2000 + Number(yearRaw);

      let iso = toIsoYmd(year, month, day);
      if (!iso) return null;
      if (!yearProvided && iso < todayYmd) {
        iso = toIsoYmd(year + 1, month, day);
      }
      return iso && inRange(iso) ? iso : null;
    }
  }

  // Fallback to the broad date parser (Gregorian + Hebrew calendar + relative).
  try {
    const formatted = await formatCampaignDate(raw, timezone);
    if (!formatted) return null;
    const dt = new Date(formatted);
    if (Number.isNaN(dt.getTime())) return null;
    const ymd = ymdFromDateInTimezone(dt, timezone);
    return ymd && inRange(ymd) ? ymd : null;
  } catch {
    return null;
  }
}

/**
 * Parses Hebrew calendar date strings like "תשרי", "ט״ו תשרי", "כ״ה תשרי תשפ״ה"
 * Returns a Promise since it uses async Hebrew calendar conversion
 */
async function parseHebrewCalendarDateFromString(input: string): Promise<Date | null> {
  // Hebrew calendar month pattern
  const hebrewMonthNames = Object.keys(hebrewCalendarMonths).join('|');

  // Try pattern: "ט״ו תשרי" (day + month) or "כ״ה תשרי תשפ״ה" (day + month + year) or "י׳ בתשרי" (day + ב + month)
  // Hebrew numerals: א=1, ב=2, ג=3, ד=4, ה=5, ו=6, ז=7, ח=8, ט=9, י=10, כ=20, ל=30, מ=40, נ=50, ס=60, ע=70, פ=80, צ=90, ק=100, ר=200, ש=300, ת=400
  // Also handle regular numbers like "15 תשרי" or "טו תשרי"
  // Note: Hebrew dates can have geresh (') or gershayim (") in numerals

  // Pattern 1: Hebrew numerals (with optional geresh/gershayim) or regular numbers + optional "ב" + month name + optional year
  // Handle both "י׳ בתשרי" (with ב) and "י׳ תשרי" (without ב) and "ט״ו תשרי"
  let match = input.match(new RegExp(`([\\u05D0-\\u05EA]{1,3}[\"'\u05F3\u05F4]?|\\d{1,2})(?:\\s*[ב]\\s*)?(${hebrewMonthNames})(?:\\s+(\\d{4}|[\\u05D0-\\u05EA]{1,4}))?`));

  if (!match) {
    // Pattern 2: Just month name (will default to 15th of month)
    match = input.match(new RegExp(`(${hebrewMonthNames})(?:\\s+(הקרוב|הבא))?(?:\\s+(\\d{4}))?`));
    if (match) {
      return await parseHebrewCalendarDate(match[1]);
    }
  } else {
    const dayStr = match[1];
    const monthName = match[2];
    const yearStr = match[3];

    // Convert Hebrew numerals to regular number if needed
    let day = parseInt(dayStr, 10);
    if (isNaN(day)) {
      day = convertHebrewNumeral(dayStr) || 15;
    }

    let hebrewYear: number | undefined;
    if (yearStr) {
      const yearNum = parseInt(yearStr, 10);
      if (!isNaN(yearNum) && yearNum > 5000) {
        hebrewYear = yearNum;
      } else {
        hebrewYear = await convertHebrewYear(yearStr);
      }
    }

    return await parseHebrewCalendarDate(monthName, day, hebrewYear);
  }

  return null;
}

/**
 * Converts Hebrew numerals to regular numbers
 */
function convertHebrewNumeral(hebrewNum: string): number | null {
  const hebrewNumerals: Record<string, number> = {
    א: 1, ב: 2, ג: 3, ד: 4, ה: 5,
    ו: 6, ז: 7, ח: 8, ט: 9, י: 10,
    כ: 20, ל: 30, מ: 40, נ: 50, ס: 60,
    ע: 70, פ: 80, צ: 90, ק: 100, ר: 200,
    ש: 300, ת: 400,
  };

  let total = 0;
  let i = 0;
  while (i < hebrewNum.length) {
    const char = hebrewNum[i];
    if (char === '"' || char === '\u05F3' || char === '\u05F4') {
      // Skip quote marks in Hebrew numerals
      i++;
      continue;
    }
    if (hebrewNumerals[char]) {
      total += hebrewNumerals[char];
    }
    i++;
  }

  return total > 0 ? total : null;
}

/**
 * Converts Hebrew year notation (e.g., "תשפ״ה" = 5785) to number
 */
async function convertHebrewYear(hebrewYearStr: string): Promise<number> {
  // For now, if it's already a 4-digit number, return it
  // Otherwise, try to parse Hebrew numerals (5000 + hundreds/tens/ones)
  const numericYear = parseInt(hebrewYearStr.replace(/[^\d]/g, ''), 10);
  if (!isNaN(numericYear) && numericYear > 5000) {
    return numericYear;
  }

  // Default: use current Hebrew year
  const { HDate } = await import('@hebcal/core');
  return new HDate().getFullYear();
}

/**
 * Parses various date formats including vague ones and relative dates
 */
function parseDate(input: string, timezone: string): Date | null {
  const today = new Date();
  const inputLower = input.toLowerCase().trim();
  const inputOriginal = input.trim();

  // Handle Hebrew relative dates FIRST (before English patterns)
  // Patterns: "בעוד X שבוע/שבועיים/חודש/חודשים/יום/ימים", "בעוד שבוע", "בשבוע הבא", etc.

  // Check for Hebrew relative date patterns
  let hebrewMatch: RegExpMatchArray | null = null;
  let amount = 0;
  let unit = '';

  // Pattern 1: "בעוד X שבוע/שבועות/חודש/חודשים/יום" or "עוד X שבועות" or "בעוד שבועיים/חודשיים"
  // CRITICAL: Must handle both "בעוד" and "עוד" (with/without ב), and plural forms "שבועות" and "חודשים"
  // IMPORTANT: Put longer matches first (שבועות before שבוע) to avoid partial matches
  hebrewMatch = inputOriginal.match(/(?:ב)?עוד\s+(\d+|שבועיים|חודשיים|יום|שבוע|חודש)\s*(שבועיים|שבועות|חודשים|שבוע|חודש|יום|ימים)?/);
  if (hebrewMatch) {
    if (/^\d+$/.test(hebrewMatch[1])) {
      // Numeric amount (e.g., "בעוד 3 שבועות")
      amount = parseInt(hebrewMatch[1], 10);
      // Normalize plural forms: "שבועות" -> "שבוע", "חודשים" -> "חודש"
      const matchedUnit = hebrewMatch[2] || 'שבוע';
      unit = matchedUnit.includes('שבוע') ? 'שבוע' : (matchedUnit.includes('חודש') ? 'חודש' : matchedUnit);
    } else if (hebrewMatch[1] === 'שבועיים') {
      amount = 2;
      unit = 'שבוע';
    } else if (hebrewMatch[1] === 'חודשיים') {
      amount = 2;
      unit = 'חודש';
    } else {
      // "בעוד שבוע", "בעוד חודש", "בעוד יום"
      amount = 1;
      unit = hebrewMatch[1];
    }
  } else {
    // Pattern 2: "בעוד שבועיים/חודשיים" or "עוד שבועיים/חודשיים" (standalone)
    hebrewMatch = inputOriginal.match(/(?:ב)?עוד\s+(שבועיים|חודשיים)/);
    if (hebrewMatch) {
      amount = 2;
      unit = hebrewMatch[1].includes('שבוע') ? 'שבוע' : 'חודש';
    } else {
      // Pattern 3: "בשבוע הבא/הקרוב", "בחודש הבא/הקרוב"
      hebrewMatch = inputOriginal.match(/בשבוע\s+(הבא|הקרוב)/);
      if (hebrewMatch) {
        amount = 1;
        unit = 'שבוע';
      } else {
        hebrewMatch = inputOriginal.match(/בחודש\s+(הבא|הקרוב)/);
        if (hebrewMatch) {
          amount = 1;
          unit = 'חודש';
        } else {
          // Pattern 4: "אחרי שבוע/חודש", "לאחר שבוע/חודש"
          // CRITICAL: Must handle plural forms "שבועות" and "חודשים"
          hebrewMatch = inputOriginal.match(/(אחרי|לאחר)\s+(\d+)?\s*(שבוע|שבועות|שבועיים|חודש|חודשים|יום|ימים)/);
          if (hebrewMatch) {
            if (hebrewMatch[2] && /^\d+$/.test(hebrewMatch[2])) {
              amount = parseInt(hebrewMatch[2], 10);
              // Normalize plural forms
              const matchedUnit = hebrewMatch[3] || 'שבוע';
              unit = matchedUnit.includes('שבוע') ? 'שבוע' : (matchedUnit.includes('חודש') ? 'חודש' : matchedUnit);
            } else if (hebrewMatch[3] === 'שבועיים' || hebrewMatch[3]?.includes('שבוע')) {
              amount = hebrewMatch[3] === 'שבועיים' ? 2 : 1;
              unit = 'שבוע';
            } else if (hebrewMatch[3] === 'חודשיים' || hebrewMatch[3]?.includes('חודש')) {
              amount = hebrewMatch[3] === 'חודשיים' ? 2 : 1;
              unit = 'חודש';
            } else {
              amount = 1;
              unit = hebrewMatch[3] || 'שבוע';
            }
          }
        }
      }
    }
  }

  if (hebrewMatch && amount > 0 && unit) {
    const result = new Date(today);
    if (unit.includes('יום')) {
      result.setDate(result.getDate() + amount);
    } else if (unit.includes('שבוע')) {
      result.setDate(result.getDate() + (amount * 7));
    } else if (unit.includes('חודש')) {
      result.setMonth(result.getMonth() + amount);
    } else {
      // Default to weeks if unit not clear
      result.setDate(result.getDate() + (amount * 7));
    }
    return result;
  }

  // Handle relative dates (e.g., "in two weeks", "next month", "in 3 days")
  // Pattern: "in X days/weeks/months" or "next week/month" or "in 2 weeks" or "2 weeks from now"
  const pattern1 = inputLower.match(/in\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)/i);
  const pattern2 = inputLower.match(/in\s+(a|an|one)\s+(day|week|month|year)/i);
  const pattern3 = inputLower.match(/(next|this)\s+(week|month|year)/i);
  const pattern4 = inputLower.match(/^(\d+)\s+(day|days|week|weeks|month|months|year|years)\s+(from\s+now|away)?/i);

  const relativeMatch = pattern1 || pattern2 || pattern3 || pattern4;

  if (relativeMatch) {
    let amount = 0;
    let unit = '';

    if (pattern1) {
      // Numeric amount with "in" (e.g., "in 2 weeks")
      amount = parseInt(pattern1[1], 10);
      unit = pattern1[2] || '';
    } else if (pattern2) {
      // "in a week", "in an hour" -> 1
      amount = 1;
      unit = pattern2[2] || '';
    } else if (pattern3) {
      // "next week", "this month"
      amount = pattern3[1] === 'next' ? 1 : 0;
      unit = pattern3[2] || '';
    } else if (pattern4) {
      // "2 weeks from now"
      amount = parseInt(pattern4[1], 10);
      unit = pattern4[2] || '';
    }

    const result = new Date(today);
    unit = unit.toLowerCase();

    if (unit.includes('day')) {
      result.setDate(result.getDate() + amount);
    } else if (unit.includes('week')) {
      result.setDate(result.getDate() + (amount * 7));
    } else if (unit.includes('month')) {
      result.setMonth(result.getMonth() + amount);
    } else if (unit.includes('year')) {
      result.setFullYear(result.getFullYear() + amount);
    }

    return result;
  }

  // Handle "tomorrow", "today", "next week", etc.
  if (inputLower === 'tomorrow' || inputLower === 'מחר' || inputLower === 'ממחר') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }
  if (inputLower === 'today' || inputLower === 'היום') {
    return today;
  }
  if (inputLower === 'next week' || inputLower.match(/בשבוע\s+הבא/i)) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek;
  }
  if (inputLower === 'next month' || inputLower.match(/בחודש\s+הבא/i)) {
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth;
  }

  // Handle Hebrew month names (both Gregorian months in Hebrew and Hebrew calendar months)
  // Gregorian months in Hebrew: ינואר, פברואר, etc.
  // Hebrew calendar months: תשרי, חשוון, כסלו, etc. - will use precise conversion
  const gregorianHebrewMonths: Record<string, number> = {
    // Gregorian months in Hebrew
    ינואר: 0, ינו: 0, יונואר: 0,
    פברואר: 1, פבר: 1, פברוואר: 1,
    מרץ: 2, מרס: 2, מארס: 2,
    אפריל: 3, אפר: 3,
    מאי: 4,
    יוני: 5, יונ: 5,
    יולי: 6, יול: 6,
    אוגוסט: 7, אוג: 7,
    ספטמבר: 8, ספט: 8, ספטמב: 8,
    אוקטובר: 9, אוק: 9, אוקטוב: 9,
    נובמבר: 10, נוב: 10, נובמב: 10,
    דצמבר: 11, דצמ: 11, דצמב: 11,
  };

  // Check if this is a Hebrew calendar month (use precise conversion)
  const hebrewCalendarMonthNames = Object.keys(hebrewCalendarMonths);
  const hebrewCalendarMonthPattern = hebrewCalendarMonthNames.join('|');

  // Try Hebrew calendar month first (precise conversion)
  let hebrewCalendarMatch = input.match(new RegExp(`(${hebrewCalendarMonthPattern})(?:\\s+(הקרוב|הבא))?(?:\\s+(\\d{4}|[\\u05D0-\\u05EA]{1,4}))?`));

  if (!hebrewCalendarMatch) {
    // Try with "חודש" prefix
    hebrewCalendarMatch = input.match(new RegExp(`חודש\\s+(${hebrewCalendarMonthPattern})(?:\\s+(הקרוב|הבא))?(?:\\s+(\\d{4}|[\\u05D0-\\u05EA]{1,4}))?`));
  }

  if (!hebrewCalendarMatch) {
    // Try with "ב" prefix (in/before month)
    hebrewCalendarMatch = input.match(new RegExp(`ב[א-ת]?\\s*(${hebrewCalendarMonthPattern})(?:\\s+(הקרוב|הבא))?(?:\\s+(\\d{4}|[\\u05D0-\\u05EA]{1,4}))?`));
  }

  // Note: Hebrew calendar parsing is now async but parseDate is sync
  // So Hebrew calendar months will be handled in parseHebrewCalendarDateFromString
  // This section only handles Gregorian months in Hebrew

  // Build regex pattern for Gregorian months in Hebrew
  const gregorianHebrewMonthPattern = Object.keys(gregorianHebrewMonths).join('|');

  // Try to match Gregorian months in Hebrew (approximate conversion)
  let hebrewMonthMatch = input.match(new RegExp(`(${gregorianHebrewMonthPattern})(?:\\s+(הקרוב|הבא))?(?:\\s+(\\d{4}))?`));

  if (!hebrewMonthMatch) {
    // Try with "חודש" prefix
    hebrewMonthMatch = input.match(new RegExp(`חודש\\s+(${gregorianHebrewMonthPattern})(?:\\s+(הקרוב|הבא))?(?:\\s+(\\d{4}))?`));
  }

  if (!hebrewMonthMatch) {
    // Try with "ב" prefix (in/before month)
    hebrewMonthMatch = input.match(new RegExp(`ב[א-ת]?\\s*(${gregorianHebrewMonthPattern})(?:\\s+(הקרוב|הבא))?(?:\\s+(\\d{4}))?`));
  }

  if (hebrewMonthMatch) {
    const hebrewMonthName = hebrewMonthMatch[1];
    const month = gregorianHebrewMonths[hebrewMonthName];
    if (month !== undefined) {
      let year = today.getFullYear();
      // Check if year is specified (might be in match[3] if "הקרוב"/"הבא" exists, or match[2] if not)
      const yearMatch = hebrewMonthMatch[3] || hebrewMonthMatch[2];
      if (yearMatch && /^\d{4}$/.test(yearMatch)) {
        year = parseInt(yearMatch, 10);
      } else {
        // If no year specified or "הקרוב"/"הבא" mentioned, determine year based on current month
        const currentMonth = today.getMonth();
        const isNextMentioned = hebrewMonthMatch[2] === 'הקרוב' || hebrewMonthMatch[2] === 'הבא' || hebrewMonthMatch[3] === 'הקרוב' || hebrewMonthMatch[3] === 'הבא';
        if (month < currentMonth || isNextMentioned) {
          // If month has passed or "next" is mentioned, use next year
          year = year + 1;
        }
      }
      // Use 15th as middle of month
      const day = 15;
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return new Date(dateStr);
    }
  }

  // Handle month-year format (e.g., "january 2026", "jan 2026", "01/2026")
  const monthYearMatch = inputLower.match(/(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{4})/i)
    || inputLower.match(/(\d{1,2})\/(\d{4})/)
    || inputLower.match(/(\d{4})-(\d{1,2})/);

  if (monthYearMatch) {
    let month: number;
    let year: number;

    if (monthYearMatch[1] && isNaN(Number(monthYearMatch[1]))) {
      // Month name
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'];
      const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
        'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthInput = monthYearMatch[1].toLowerCase();
      month = monthNames.findIndex((m) => m.startsWith(monthInput));
      if (month === -1) {
        month = monthAbbr.findIndex((m) => m === monthInput);
      }
      if (month === -1) month = 0;
      year = parseInt(monthYearMatch[2], 10);
    } else {
      // Numeric month
      month = parseInt(monthYearMatch[1], 10) - 1;
      year = parseInt(monthYearMatch[2] || monthYearMatch[1], 10);
    }

    // Guess day: beginning (1st), middle (15th), or end (last day) of month
    // For simplicity, we'll use the 15th (middle of month)
    const day = 15;

    // Create date in the specified timezone
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return new Date(dateStr);
  }

  // Try standard date parsing
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

/**
 * Formats a date as ISO 8601 with timezone offset
 * Creates a date in the target timezone and converts to UTC
 */
function formatDateWithTimezone(date: Date, timezone: string, time: string = '00:00:00'): string {
  // Extract date components
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // Parse time components
  const [hours, minutes, seconds] = time.split(':').map(Number);

  try {
    // Create a date string representing the desired local time in the target timezone
    // Format: YYYY-MM-DDTHH:mm:ss
    const dateTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds || 0).padStart(2, '0')}`;

    // Use a workaround: create the date as if it's in UTC, then calculate the offset
    // and adjust to get the correct UTC time that represents the local time in the target timezone

    // Step 1: Create a date in UTC with our desired components
    const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds || 0));

    // Step 2: Format this UTC date in the target timezone to see what it would show
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(utcDate);
    const tzYear = parseInt(parts.find((p) => p.type === 'year')?.value || String(year), 10);
    const tzMonth = parseInt(parts.find((p) => p.type === 'month')?.value || String(month + 1), 10) - 1;
    const tzDay = parseInt(parts.find((p) => p.type === 'day')?.value || String(day), 10);
    const tzHour = parseInt(parts.find((p) => p.type === 'hour')?.value || String(hours), 10);
    const tzMinute = parseInt(parts.find((p) => p.type === 'minute')?.value || String(minutes), 10);
    const tzSecond = parseInt(parts.find((p) => p.type === 'second')?.value || String(seconds || 0), 10);

    // Step 3: Calculate the offset (difference between what we want and what we got)
    const desiredTzTime = new Date(Date.UTC(year, month, day, hours, minutes, seconds || 0));
    const actualTzTime = new Date(Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, tzSecond));
    const offset = desiredTzTime.getTime() - actualTzTime.getTime();

    // Step 4: Adjust the UTC date by the offset to get the correct UTC time
    const correctedUtcDate = new Date(utcDate.getTime() - offset);

    return correctedUtcDate.toISOString();
  } catch (error) {
    // Fallback: create date assuming UTC
    const fallbackDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds || 0));
    return fallbackDate.toISOString();
  }
}
