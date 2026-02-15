import { pickUserSegmentLabelHeFromText } from '../../lib/insurance/segments/pickUserSegmentLabelHe';
import { setSegmentsCatalogProdOverride } from '../../lib/insurance/segments/loadSegmentsCatalog';

beforeAll(() => {
  setSegmentsCatalogProdOverride({
    catalog_id: 'test-user-label',
    catalog_version: '0',
    environment: 'test',
    segment_groups: [
      { group_id: 'professional_offices', group_name_he: 'משרדים ושירותים מקצועיים', default_package_key: 'pkg' } as any,
    ],
    segments: [
      {
        segment_id: 'architecture_engineering_office',
        segment_group_id: 'professional_offices',
        segment_name_he: 'משרד אדריכלים / מהנדסים',
        keywords: ['משרד מהנדסים', 'מהנדס', 'מהנדסים', 'אדריכל', 'אדריכלים'],
      } as any,
    ],
  } as any);
});

describe('pickUserSegmentLabelHeFromText', () => {
  test('returns explicit keyword phrase when present in message', () => {
    const rawText = 'הי. אני רוצה ביטוח למשרד מהנדסים.';
    const res = pickUserSegmentLabelHeFromText({ rawText, resolvedSegmentId: 'architecture_engineering_office' });
    expect(res).toBe('משרד מהנדסים');
  });
});

