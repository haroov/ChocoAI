import { validateFieldValue } from '../../lib/flowEngine/fieldValidation';
import { getFieldDisplayNameHe } from '../../lib/flowEngine/fieldValidation';

describe('fieldValidation - first_name/last_name', () => {
  const namePattern = "^(?=(?:.*[A-Za-zא-ת]){2,})(?!.*([A-Za-zא-ת])\\1\\1)[A-Za-zא-ת\\s\\-־'\"’“”׳״]+$";
  const nameField = {
    type: 'string' as const,
    description: 'שם',
    minLength: 2,
    pattern: namePattern,
    prohibitedWordsList: 'hebrew_prohibited_words_v1',
  };

  test('accepts Hebrew/English names with common punctuation', () => {
    const okSamples = [
      'עין-בר',
      'זה״ב',
      'ג׳ורג׳',
      'Ben-Gurion',
      'John Doe',
      'יעל שרה',
      'פינקלמן נייגר',
    ];
    for (const v of okSamples) {
      const res = validateFieldValue('first_name', nameField as any, v);
      expect(res.ok).toBe(true);
    }
  });

  test('requires at least 2 characters (minLength guard)', () => {
    const res = validateFieldValue('first_name', nameField as any, 'ב');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('minLength');
  });

  test('rejects triple repeated letters', () => {
    const res = validateFieldValue('first_name', nameField as any, 'ללל');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('pattern');
  });

  test('rejects prohibited words (substring match) including punctuation bypass', () => {
    const samples = [
      'הומו',
      'ז-ו-נ-ה',
      'בןזונה', // substring match (strict mode)
    ];
    for (const v of samples) {
      const res = validateFieldValue('first_name', nameField as any, v);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('prohibited_word');
    }
  });

  test('rejects digits and other disallowed characters', () => {
    const res = validateFieldValue('first_name', nameField as any, 'John3');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('pattern');
  });

  test('Hebrew display name is personalized for invalid retry prompts', () => {
    expect(getFieldDisplayNameHe('first_name')).toBe('השם הפרטי');
    expect(getFieldDisplayNameHe('last_name')).toBe('שם המשפחה');
  });
});

