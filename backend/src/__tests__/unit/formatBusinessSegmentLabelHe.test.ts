import { formatBusinessSegmentLabelHe, looksLikeNoiseBusinessSegmentHe } from '../../lib/insurance/segments/formatBusinessSegmentLabelHe';

describe('formatBusinessSegmentLabelHe', () => {
  test('prefixes office label for professional_offices (insurance agent)', () => {
    const label = formatBusinessSegmentLabelHe({
      segment_name_he: 'סוכן ביטוח',
      segment_group_id: 'professional_offices',
    });
    expect(label).toBe('משרד סוכן ביטוח');
  });

  test('does not double-prefix when label already starts with "משרד"', () => {
    const label = formatBusinessSegmentLabelHe({
      segment_name_he: 'משרד עורכי דין',
      segment_group_id: 'professional_offices',
    });
    expect(label).toBe('משרד עורכי דין');
  });
});

describe('looksLikeNoiseBusinessSegmentHe', () => {
  test('treats generic intent words as noise', () => {
    expect(looksLikeNoiseBusinessSegmentHe('לביטוח')).toBe(true);
    expect(looksLikeNoiseBusinessSegmentHe('הצעת ביטוח')).toBe(true);
    expect(looksLikeNoiseBusinessSegmentHe('משרד')).toBe(true);
  });

  test('treats real occupations as non-noise', () => {
    expect(looksLikeNoiseBusinessSegmentHe('משרד סוכן ביטוח')).toBe(false);
    expect(looksLikeNoiseBusinessSegmentHe('משרד רואי חשבון')).toBe(false);
  });
});

