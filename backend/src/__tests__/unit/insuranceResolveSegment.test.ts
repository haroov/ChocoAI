import { resolveSegmentFromText } from '../../lib/insurance/segments/resolveSegmentFromText';

describe('resolveSegmentFromText (deterministic catalog)', () => {
  test('matches law firm segment deterministically', async () => {
    const res = await resolveSegmentFromText('משרד עורכי דין');
    expect(res.source).toBe('catalog');
    // Catalog may contain multiple valid IDs for the same Hebrew label.
    expect(['law_firm', 'clal_professional_offices_lawyer']).toContain(res.segment_id);
    expect(res.segment_group_id).toBe('professional_offices');
    expect(res.match_confidence).toBeGreaterThanOrEqual(0.55);
  });
});

