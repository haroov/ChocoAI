import { validateFieldValue } from '../../lib/flowEngine/fieldValidation';

describe('validateFieldValue: business_po_box', () => {
  const def = { type: 'string' as const, description: 'ת.ד.' };

  test('accepts "אין" as false', () => {
    const res = validateFieldValue('business_po_box', def as any, 'אין');
    expect(res.ok).toBe(true);
    expect((res as any).normalizedValue).toBe(false);
  });

  test('accepts "אין." / "לא!" variants as false', () => {
    for (const v of ['אין.', 'אין!', 'לא.', 'לא!', 'ללא.']) {
      const res = validateFieldValue('business_po_box', def as any, v);
      expect(res.ok).toBe(true);
      expect((res as any).normalizedValue).toBe(false);
    }
  });

  test('accepts digits up to 7', () => {
    const res = validateFieldValue('business_po_box', def as any, 'ת"ד 105');
    expect(res.ok).toBe(true);
    expect((res as any).normalizedValue).toBe('105');
  });

  test('rejects long numeric token', () => {
    const res = validateFieldValue('business_po_box', def as any, '42850000');
    expect(res.ok).toBe(false);
  });
});

