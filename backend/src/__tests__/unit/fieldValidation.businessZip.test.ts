import { validateFieldValue } from '../../lib/flowEngine/fieldValidation';

describe('validateFieldValue: business_zip', () => {
  const def = { type: 'string' as const, description: 'מיקוד' };

  test('accepts 5 digits not starting with 0', () => {
    const res = validateFieldValue('business_zip', def as any, '12345');
    expect(res.ok).toBe(true);
    expect((res as any).normalizedValue).toBe('12345');
  });

  test('accepts 7 digits not starting with 0', () => {
    const res = validateFieldValue('business_zip', def as any, '1234567');
    expect(res.ok).toBe(true);
    expect((res as any).normalizedValue).toBe('1234567');
  });

  test('rejects zip starting with 0', () => {
    const res = validateFieldValue('business_zip', def as any, '0123456');
    expect(res.ok).toBe(false);
  });

  test('accepts unknown token', () => {
    const res = validateFieldValue('business_zip', def as any, 'לא ידוע');
    expect(res.ok).toBe(true);
    expect((res as any).normalizedValue).toBe('לא ידוע');
  });

  test('treats 0 as unknown', () => {
    const res = validateFieldValue('business_zip', def as any, '0');
    expect(res.ok).toBe(true);
    expect((res as any).normalizedValue).toBe('לא ידוע');
  });
});

