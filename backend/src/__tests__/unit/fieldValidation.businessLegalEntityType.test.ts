import { validateFieldValue } from '../../lib/flowEngine/fieldValidation';
import { FieldDefinition } from '../../lib/flowEngine/types';

describe('fieldValidation - business_legal_entity_type', () => {
  const field: FieldDefinition = {
    type: 'string',
    description: 'יישות משפטית',
    enum: [
      'חברה פרטית',
      'עוסק מורשה',
      'עוסק פטור',
      'עוסק זעיר',
      'שותפות',
      'אגודה',
      'עמותה',
      'חברה ציבורית',
    ],
  };

  test('maps ע״מ (gershayim) to עוסק מורשה', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'ע״מ');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('עוסק מורשה');
  });

  test('maps ע"מ (straight quote) to עוסק מורשה', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'ע"מ');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('עוסק מורשה');
  });

  test('maps ח״פ to חברה פרטית', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'ח״פ');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('חברה פרטית');
  });

  test('maps חברה בע״מ to חברה פרטית', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'חברה בע״מ');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('חברה פרטית');
  });

  test('maps פרטית to חברה פרטית', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'פרטית');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('חברה פרטית');
  });

  test('maps ציבורית to חברה ציבורית', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'ציבורית');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('חברה ציבורית');
  });

  test('accepts already-canonical value', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'עוסק פטור');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('עוסק פטור');
  });

  test('rejects unknown value', () => {
    const res = validateFieldValue('business_legal_entity_type', field, 'לא יודע');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('enum');
  });
});

