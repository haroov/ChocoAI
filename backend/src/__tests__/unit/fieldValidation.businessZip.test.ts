import { validateFieldValue } from '../../lib/flowEngine/fieldValidation';
import type { FieldDefinition } from '../../lib/flowEngine/types';

describe('validateFieldValue: business_zip', () => {
  const def = { type: 'string' as const, description: 'מיקוד' } satisfies FieldDefinition;

  test('accepts 5 digits not starting with 0', () => {
    const res = validateFieldValue('business_zip', def, '12345');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok=true');
    expect(res.normalizedValue).toBe('12345');
  });

  test('accepts 7 digits not starting with 0', () => {
    const res = validateFieldValue('business_zip', def, '1234567');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok=true');
    expect(res.normalizedValue).toBe('1234567');
  });

  test('rejects zip starting with 0', () => {
    const res = validateFieldValue('business_zip', def, '0123456');
    expect(res.ok).toBe(false);
  });

  test('accepts "לא ידוע" token', () => {
    const res = validateFieldValue('business_zip', def, 'לא ידוע');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok=true');
    expect(res.normalizedValue).toBe('לא ידוע');
  });

  test('treats 0 as "לא ידוע"', () => {
    const res = validateFieldValue('business_zip', def, '0');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok=true');
    expect(res.normalizedValue).toBe('לא ידוע');
  });
});

