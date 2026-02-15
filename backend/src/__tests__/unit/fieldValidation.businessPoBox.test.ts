import { validateFieldValue } from '../../lib/flowEngine/fieldValidation';
import type { FieldDefinition } from '../../lib/flowEngine/types';

describe('validateFieldValue: business_po_box', () => {
  const def = { type: 'string' as const, description: 'ת.ד.' } satisfies FieldDefinition;

  test('accepts "אין" as false', () => {
    const res = validateFieldValue('business_po_box', def, 'אין');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok=true');
    expect(res.normalizedValue).toBe(false);
  });

  test('accepts "אין." / "לא!" variants as false', () => {
    for (const v of ['אין.', 'אין!', 'לא.', 'לא!', 'ללא.']) {
      const res = validateFieldValue('business_po_box', def, v);
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('Expected ok=true');
      expect(res.normalizedValue).toBe(false);
    }
  });

  test('accepts digits up to 7', () => {
    const res = validateFieldValue('business_po_box', def, 'ת\"ד 105');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok=true');
    expect(res.normalizedValue).toBe('105');
  });

  test('rejects long numeric token', () => {
    const res = validateFieldValue('business_po_box', def, '42850000');
    expect(res.ok).toBe(false);
  });
});

