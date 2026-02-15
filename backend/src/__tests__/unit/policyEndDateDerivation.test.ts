import { derivePolicyEndDateFromStartYmd } from '../../lib/flowEngine/utils/dateTimeUtils';

describe('derivePolicyEndDateFromStartYmd', () => {
  test('derives end-of-month for start + 11 months when day <= 15', () => {
    expect(derivePolicyEndDateFromStartYmd('2026-03-01')).toBe('2027-02-28');
    expect(derivePolicyEndDateFromStartYmd('2026-02-15')).toBe('2027-01-31');
  });

  test('derives end-of-month for start + 12 months when day >= 16', () => {
    expect(derivePolicyEndDateFromStartYmd('2026-02-16')).toBe('2027-02-28');
    expect(derivePolicyEndDateFromStartYmd('2026-12-31')).toBe('2027-12-31');
  });

  test('returns null for invalid input', () => {
    expect(derivePolicyEndDateFromStartYmd('')).toBeNull();
    expect(derivePolicyEndDateFromStartYmd('2026-02-30')).toBeNull();
    expect(derivePolicyEndDateFromStartYmd('not-a-date')).toBeNull();
  });
});

