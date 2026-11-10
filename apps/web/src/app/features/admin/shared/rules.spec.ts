import {
  checkPricingBounds,
  clickThroughRate,
  formatRate,
  generateTemporaryPassword,
  isAllowedCtaUrl,
  slugify,
} from './rules';

describe('checkPricingBounds', () => {
  it('accepts min <= typical <= max', () => {
    expect(checkPricingBounds({ minPerKm: 12, perKm: 18, maxPerKm: 30 })).toBeNull();
    expect(checkPricingBounds({ minPerKm: 18, perKm: 18, maxPerKm: 18 })).toBeNull();
  });

  it('leaves blanks to the required validator', () => {
    expect(checkPricingBounds({ minPerKm: null, perKm: 18, maxPerKm: 30 })).toBeNull();
  });

  it('rejects a range that is upside down', () => {
    expect(checkPricingBounds({ minPerKm: 40, perKm: 30, maxPerKm: 20 })).toMatch(/lowest/);
  });

  it('rejects a typical rate outside the range', () => {
    expect(checkPricingBounds({ minPerKm: 12, perKm: 10, maxPerKm: 30 })).toMatch(/below/);
    expect(checkPricingBounds({ minPerKm: 12, perKm: 35, maxPerKm: 30 })).toMatch(/above/);
  });

  it('rejects zero and negative rates', () => {
    expect(checkPricingBounds({ minPerKm: 0, perKm: 10, maxPerKm: 30 })).toMatch(/more than zero/);
    expect(checkPricingBounds({ minPerKm: -5, perKm: 10, maxPerKm: 30 })).toMatch(/more than zero/);
  });
});

describe('clickThroughRate', () => {
  it('is clicks over impressions', () => {
    expect(clickThroughRate(200, 7)).toBeCloseTo(0.035);
  });

  it('is unknown until there is an impression', () => {
    expect(clickThroughRate(0, 0)).toBeNull();
    expect(clickThroughRate(0, 3)).toBeNull();
  });

  it('formats as a percentage, or a dash when unknown', () => {
    expect(formatRate(0.035)).toBe('3.50%');
    expect(formatRate(0.25)).toBe('25.0%');
    expect(formatRate(null)).toBe('—');
  });
});

describe('isAllowedCtaUrl', () => {
  it('allows https pages and tel numbers', () => {
    expect(isAllowedCtaUrl('https://example.in/menu')).toBe(true);
    expect(isAllowedCtaUrl('tel:+919876543210')).toBe(true);
    expect(isAllowedCtaUrl('  https://cafe.example.com  ')).toBe(true);
  });

  it('refuses everything that could run code or leak the visitor', () => {
    const refused = [
      '',
      'http://example.in',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'mailto:a@b.in',
      '/relative/path',
      'https://user:pass@example.in',
      'https://localhost',
      'tel:abc',
    ];
    for (const bad of refused) {
      expect(isAllowedCtaUrl(bad)).toBe(false);
    }
  });
});

describe('slugify', () => {
  it('makes a URL-safe key', () => {
    expect(slugify('Mirjan Fort & Kumta')).toBe('mirjan-fort-kumta');
    expect(slugify('  Yana Caves — Vibhooti Falls ')).toBe('yana-caves-vibhooti-falls');
  });
});

describe('generateTemporaryPassword', () => {
  it('produces four groups of four characters', () => {
    let n = 0;
    const password = generateTemporaryPassword((max) => n++ % max);
    expect(password).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(password.length).toBeGreaterThanOrEqual(12);
  });
});
