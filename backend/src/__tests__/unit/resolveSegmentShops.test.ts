import { resolveSegmentFromText } from '../../lib/insurance/segments/resolveSegmentFromText';
import { setSegmentsCatalogProdOverride } from '../../lib/insurance/segments/loadSegmentsCatalog';

beforeAll(() => {
  setSegmentsCatalogProdOverride({
    catalog_id: 'test-shops',
    catalog_version: '0',
    environment: 'test',
    segment_groups: [
      { group_id: 'shops', group_name_he: 'חנויות', default_package_key: 'pkg_shops' } as any,
    ],
    segments: [
      {
        segment_id: 'clothing_shop',
        segment_group_id: 'shops',
        segment_name_he: 'חנות בגדים ומוצרי עור',
        keywords: ['חנות בגדים', 'מוצרי הלבשה', 'מוצרי עור'],
        business_profile_defaults: { primary_activity_he: 'ביגוד', site_type_he: 'חנות', has_physical_location: true },
        default_package_key: 'pkg_shops',
      } as any,
      {
        segment_id: 'flower_shop',
        segment_group_id: 'shops',
        segment_name_he: 'חנות פרחים',
        keywords: ['חנות פרחים'],
        business_profile_defaults: { primary_activity_he: 'פרחים', site_type_he: 'חנות', has_physical_location: true },
        default_package_key: 'pkg_shops',
      } as any,
    ],
  } as any);
});

describe('resolveSegmentFromText (shops tie-break)', () => {
  test('prefers clothing shop when input says חנות בגדים (not flowers)', async () => {
    const text = 'הי, אני בעלים של חנות בגדים. אשמח להצעת ביטוח. תודה רבה, ליאב גפן';
    const res = await resolveSegmentFromText(text);
    expect(res.source).toBe('catalog');
    expect(res.segment_id).toBe('clothing_shop');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });
});

