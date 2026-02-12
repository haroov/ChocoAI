import { parsePolicyStartDateToYmd } from '../../lib/flowEngine/utils/dateTimeUtils';

describe('parsePolicyStartDateToYmd', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    // Keep the time well away from any day-boundary in Asia/Jerusalem.
    jest.setSystemTime(new Date('2026-02-11T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('parses Hebrew relative "ממחר" as tomorrow', async () => {
    await expect(parsePolicyStartDateToYmd('ממחר', 'Asia/Jerusalem')).resolves.toBe('2026-02-12');
  });

  test('parses Hebrew relative "מחר" as tomorrow', async () => {
    await expect(parsePolicyStartDateToYmd('מחר', 'Asia/Jerusalem')).resolves.toBe('2026-02-12');
  });

  test('accepts ISO YYYY-MM-DD', async () => {
    await expect(parsePolicyStartDateToYmd('2026-02-12', 'Asia/Jerusalem')).resolves.toBe('2026-02-12');
  });

  test('parses DD/MM/YYYY (Israel default)', async () => {
    await expect(parsePolicyStartDateToYmd('12/2/2026', 'Asia/Jerusalem')).resolves.toBe('2026-02-12');
  });

  test('parses DD-MM-YY (2-digit year -> 2000+YY)', async () => {
    await expect(parsePolicyStartDateToYmd('12-02-26', 'Asia/Jerusalem')).resolves.toBe('2026-02-12');
  });

  test('enforces min=today (rejects past dates)', async () => {
    await expect(parsePolicyStartDateToYmd('2026-02-10', 'Asia/Jerusalem')).resolves.toBeNull();
  });

  test('enforces max=today+45 (accepts boundary, rejects beyond)', async () => {
    await expect(parsePolicyStartDateToYmd('2026-03-28', 'Asia/Jerusalem')).resolves.toBe('2026-03-28');
    await expect(parsePolicyStartDateToYmd('2026-03-29', 'Asia/Jerusalem')).resolves.toBeNull();
  });

  test('parses "תחילת החודש הבא" as first day of next month', async () => {
    await expect(parsePolicyStartDateToYmd('תחילת החודש הבא', 'Asia/Jerusalem')).resolves.toBe('2026-03-01');
  });

  test('parses "אמצע החודש הבא" as 15th of next month', async () => {
    await expect(parsePolicyStartDateToYmd('אמצע החודש הבא', 'Asia/Jerusalem')).resolves.toBe('2026-03-15');
  });

  test('parses "תחילת השבוע הבא" as next Sunday (Israel week start)', async () => {
    // With system time set to 2026-02-11, next week start is Sunday 2026-02-15.
    await expect(parsePolicyStartDateToYmd('תחילת השבוע הבא', 'Asia/Jerusalem')).resolves.toBe('2026-02-15');
  });

  test('rejects out-of-range future date like 1/3/27', async () => {
    await expect(parsePolicyStartDateToYmd('1/3/27', 'Asia/Jerusalem')).resolves.toBeNull();
  });
});

