import { inferInsuredRelationToBusinessHe } from '../../lib/flowEngine/utils/insuredRelationInference';

describe('inferInsuredRelationToBusinessHe', () => {
  test('infers owner from explicit first-person phrase', () => {
    expect(inferInsuredRelationToBusinessHe('אני בעלים של משרד הנדסה')).toBe('בעלים');
    expect(inferInsuredRelationToBusinessHe('אני בעלת משרד עורכי דין')).toBe('בעלים');
  });

  test('infers owner from role-at-start reply', () => {
    expect(inferInsuredRelationToBusinessHe('בעלים של חנות מוצרי חשמל')).toBe('בעלים');
    expect(inferInsuredRelationToBusinessHe('בעלת מסעדה')).toBe('בעלים');
  });

  test('infers manager', () => {
    expect(inferInsuredRelationToBusinessHe('אני מנהלת של סניף')).toBe('מנהל');
    expect(inferInsuredRelationToBusinessHe('מנהל חנות')).toBe('מנהל');
  });

  test('infers authorized signatory', () => {
    expect(inferInsuredRelationToBusinessHe('אני מורשה חתימה')).toBe('מורשה חתימה');
    expect(inferInsuredRelationToBusinessHe('מורשה חתימה בחברה')).toBe('מורשה חתימה');
    expect(inferInsuredRelationToBusinessHe('מורשה חתימה')).toBe('מורשה חתימה');
  });

  test('does not infer from unrelated mentions', () => {
    expect(inferInsuredRelationToBusinessHe('דיברתי עם הבעלים')).toBe(null);
    expect(inferInsuredRelationToBusinessHe('לבעלים אין מפתח')).toBe(null);
    expect(inferInsuredRelationToBusinessHe('שלום')).toBe(null);
  });
});

