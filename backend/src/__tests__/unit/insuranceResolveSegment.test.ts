import { resolveSegmentFromText } from '../../lib/insurance/segments/resolveSegmentFromText';
import { setSegmentsCatalogProdOverride } from '../../lib/insurance/segments/loadSegmentsCatalog';

beforeAll(() => {
  // Minimal fixture so unit tests don't depend on DB seeding.
  setSegmentsCatalogProdOverride({
    catalog_id: 'test',
    catalog_version: '0',
    environment: 'test',
    segment_groups: [
      { group_id: 'professional_offices', group_name_he: 'משרדים ושירותים מקצועיים', default_package_key: 'pkg_prof' } as any,
    ],
    segments: [
      {
        segment_id: 'law_firm',
        segment_group_id: 'professional_offices',
        segment_name_he: 'משרד עורכי דין',
        keywords: ['עו"ד', 'עו״ד', 'עורך דין', 'משרד עורכי דין'],
        business_profile_defaults: { primary_activity_he: 'שירותים משפטיים', site_type_he: 'משרד', has_physical_location: true },
        default_package_key: 'pkg_prof',
      } as any,
      {
        segment_id: 'insurance_agent',
        segment_group_id: 'professional_offices',
        segment_name_he: 'סוכן ביטוח',
        keywords: ['סוכן ביטוח', 'סוכנות ביטוח', 'משרד ביטוח'],
        business_profile_defaults: { primary_activity_he: 'לתווך בעסקאות ביטוח', site_type_he: 'משרד', has_physical_location: true },
        default_package_key: 'pkg_prof',
      } as any,
      {
        segment_id: 'architecture_engineering_office',
        segment_group_id: 'professional_offices',
        segment_name_he: 'משרד אדריכלים',
        keywords: ['אדריכל', 'אדריכלים', 'אדריכלות'],
        business_profile_defaults: { primary_activity_he: 'שירותי אדריכלות והנדסה', site_type_he: 'משרד', has_physical_location: true },
        default_package_key: 'pkg_prof',
      } as any,
      {
        segment_id: 'accounting_firm',
        segment_group_id: 'professional_offices',
        segment_name_he: 'משרד רואי חשבון / הנהלת חשבונות',
        // Intentionally no keywords: we still expect to match via abbreviation aliases (רו״ח -> רואי חשבון)
        business_profile_defaults: { primary_activity_he: 'שירותי הנהלת חשבונות, ביקורת וייעוץ פיננסי', site_type_he: 'משרד', has_physical_location: true },
        default_package_key: 'pkg_prof',
      } as any,
    ],
  } as any);
});

describe('resolveSegmentFromText (deterministic catalog)', () => {
  test('matches law firm segment deterministically', async () => {
    const res = await resolveSegmentFromText('משרד עורכי דין');
    expect(res.source).toBe('catalog');
    // Catalog may contain multiple valid IDs for the same Hebrew label.
    expect(['law_firm', 'clal_professional_offices_lawyer']).toContain(res.segment_id);
    expect(res.segment_group_id).toBe('professional_offices');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });

  test('does not misclassify lawyer as insurance agent when request includes "ביטוח"', async () => {
    const res = await resolveSegmentFromText('הי, אני רוצה הצעת ביטוח למשרד עו״ד');
    expect(res.source).toBe('catalog');
    expect(res.segment_id).toBe('law_firm');
    expect(res.segment_group_id).toBe('professional_offices');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });

  test('matches architecture/engineering office from a longer request', async () => {
    const res = await resolveSegmentFromText('הי, אני רוצה הצעה לביטוח משרד אדריכלים. תודה, ליאב - 050-6806888');
    expect(res.source).toBe('catalog');
    expect(res.segment_id).toBe('architecture_engineering_office');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });

  test('matches architect when message uses prefixed form (לאדריכל)', async () => {
    const res = await resolveSegmentFromText('הי, אני רוצה הצעת ביטוח לאדריכל');
    expect(res.source).toBe('catalog');
    expect(res.segment_id).toBe('architecture_engineering_office');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });

  test('matches accounting firm from abbreviation (רו״ח)', async () => {
    const res = await resolveSegmentFromText('צריך הצעת ביטוח למשרד רו״ח');
    expect(res.source).toBe('catalog');
    expect(res.segment_id).toBe('accounting_firm');
    expect(res.segment_group_id).toBe('professional_offices');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });

  test('matches accounting firm when abbreviation has punctuation (רו״ח.)', async () => {
    const res = await resolveSegmentFromText('שלום. אני רוצה הצעת ביטוח למשרד רו״ח. תודה');
    expect(res.source).toBe('catalog');
    expect(res.segment_id).toBe('accounting_firm');
    expect(res.segment_group_id).toBe('professional_offices');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });
});

