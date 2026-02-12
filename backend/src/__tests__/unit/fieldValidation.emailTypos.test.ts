import { suggestEmailCorrection, validateEmailValue, validateFieldValue } from '../../lib/flowEngine/fieldValidation';
import { FieldDefinition } from '../../lib/flowEngine/types';

describe('fieldValidation - email typo detection', () => {
  const emailField: FieldDefinition = {
    type: 'string',
    description: 'אימייל',
  };

  test('suggests .con -> .com', () => {
    expect(suggestEmailCorrection('user@domain.con')).toBe('user@domain.com');
    const res = validateFieldValue('email', emailField, 'user@domain.con');
    expect(res.ok).toBe(false);
    expect(res.suggestion).toBe('user@domain.com');
  });

  test('suggests gamil.com -> gmail.com', () => {
    expect(suggestEmailCorrection('user@gamil.com')).toBe('user@gmail.com');
    const res = validateFieldValue('email', emailField, 'user@gamil.com');
    expect(res.ok).toBe(false);
    expect(res.suggestion).toBe('user@gmail.com');
  });

  test('accepts a valid email and normalizes domain case', () => {
    const v = validateEmailValue('Liav@Geffen.ORG.IL');
    expect(v.ok).toBe(true);
    expect(v.normalized).toBe('Liav@geffen.org.il');
    const res = validateFieldValue('email', emailField, 'Liav@Geffen.ORG.IL');
    expect(res.ok).toBe(true);
    expect(res.normalizedValue).toBe('Liav@geffen.org.il');
  });
});

