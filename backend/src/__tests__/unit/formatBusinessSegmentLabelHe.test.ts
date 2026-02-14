import {
  formatBusinessSegmentLabelHe,
  looksLikeNoiseBusinessSegmentHe,
  shouldOverrideBusinessSegmentHe,
} from '../../lib/insurance/segments/formatBusinessSegmentLabelHe';

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

describe('shouldOverrideBusinessSegmentHe', () => {
  test('overrides when existing is noise', () => {
    expect(shouldOverrideBusinessSegmentHe('לביטוח', 'משרד סוכן ביטוח')).toBe(true);
    expect(shouldOverrideBusinessSegmentHe('', 'משרד סוכן ביטוח')).toBe(true);
  });

  test('does not override when user terminology differs meaningfully (משרד הנדסאים)', () => {
    expect(shouldOverrideBusinessSegmentHe('משרד הנדסאים', 'משרד אדריכלים')).toBe(false);
  });

  test('overrides when desired is a refinement that includes existing (prefixing משרד)', () => {
    expect(shouldOverrideBusinessSegmentHe('אדריכלים', 'משרד אדריכלים')).toBe(true);
  });
});
