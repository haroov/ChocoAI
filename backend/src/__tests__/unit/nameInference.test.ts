import { inferFirstLastFromText, repairNameFieldsFromInference } from '../../lib/flowEngine/nameInference';

describe('nameInference', () => {
  test('inferFirstLastFromText extracts Hebrew name from contact block', () => {
    const text = [
      'ליאב גפן',
      'נייד',
      '050-6806888',
      'מייל',
      'liav@geffen.org.il',
    ].join('\n');

    expect(inferFirstLastFromText(text)).toEqual({ first: 'ליאב', last: 'גפן' });
  });

  test('repairNameFieldsFromInference repairs both first+last when last is a contact label', () => {
    const text = [
      'ליאב גפן',
      'נייד',
      '050-6806888',
      'מייל',
      'liav@geffen.org.il',
    ].join('\n');
    const inferred = inferFirstLastFromText(text);

    const current = {};
    const augmented = {
      user_first_name: 'גפן',
      user_last_name: 'נייד',
    };

    const repaired = repairNameFieldsFromInference({ current, augmented, inferred });
    expect(repaired.user_first_name).toBe('ליאב');
    expect(repaired.user_last_name).toBe('גפן');
  });

  test('repairNameFieldsFromInference fixes swapped stored names when inferred pair is valid', () => {
    const text = 'ליאב גפן';
    const inferred = inferFirstLastFromText(text);

    const current = {
      user_first_name: 'גפן',
      user_last_name: 'ליאב',
    };
    const augmented = {};

    const repaired = repairNameFieldsFromInference({ current, augmented, inferred });
    expect(repaired.user_first_name).toBe('ליאב');
    expect(repaired.user_last_name).toBe('גפן');
  });

  test('repairNameFieldsFromInference never overrides explicit good values in augmented update', () => {
    const inferred = inferFirstLastFromText('ליאב גפן');

    const current = {};
    const augmented = {
      user_first_name: 'ליאב', // explicit good value (should be preserved)
      user_last_name: '', // missing/bad -> should be repaired
    };

    const repaired = repairNameFieldsFromInference({ current, augmented, inferred });
    expect(repaired.user_first_name).toBe('ליאב');
    expect(repaired.user_last_name).toBe('גפן');
  });

  test('repairNameFieldsFromInference does not split multi-word explicit first name into last name', () => {
    const inferred = inferFirstLastFromText('ניצן אריאלה');
    const current = {};
    const augmented = {
      first_name: 'ניצן אריאלה', // explicit multi-word first name (common in IL)
      last_name: '',
    };
    const repaired = repairNameFieldsFromInference({ current, augmented, inferred });
    expect(repaired.first_name).toBe('ניצן אריאלה');
    // Do not infer/set last name from the second token in the same string
    expect(String(repaired.last_name || '')).toBe('');
    // Also: do not infer alias groups in this turn (prevents overwrite via alias writes)
    expect('user_first_name' in repaired).toBe(false);
    expect('user_last_name' in repaired).toBe(false);
    expect('proposer_first_name' in repaired).toBe(false);
    expect('proposer_last_name' in repaired).toBe(false);
  });

  test('repairNameFieldsFromInference does not split multi-word explicit last name into first name', () => {
    const inferred = inferFirstLastFromText('שפרלינג גפן');
    const current = {};
    const augmented = {
      first_name: '',
      last_name: 'שפרלינג גפן', // explicit multi-word last name
    };
    const repaired = repairNameFieldsFromInference({ current, augmented, inferred });
    expect(repaired.last_name).toBe('שפרלינג גפן');
    expect(String(repaired.first_name || '')).toBe('');
  });
});

