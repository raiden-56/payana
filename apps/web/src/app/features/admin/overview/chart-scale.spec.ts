import { buildTrend, describeTrend, niceCeiling, type ChartBox } from './chart-scale';

const BOX: ChartBox = { width: 700, height: 300, top: 20, right: 20, bottom: 30, left: 40 };

describe('niceCeiling', () => {
  it('rounds up to a readable axis maximum', () => {
    expect(niceCeiling(0)).toBe(4);
    expect(niceCeiling(3)).toBe(4);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(18)).toBe(20);
    expect(niceCeiling(23)).toBe(25);
    expect(niceCeiling(42)).toBe(50);
    expect(niceCeiling(130)).toBe(200);
  });
});

describe('buildTrend', () => {
  const points = [
    { date: '2026-11-01', requests: 10, bookings: 5 },
    { date: '2026-11-02', requests: 20, bookings: 0 },
  ];

  it('puts zero on the baseline and the maximum at the top of the plot', () => {
    const geo = buildTrend(points, BOX);
    expect(geo.max).toBe(20);
    expect(geo.baseline).toBe(270);
    expect(geo.bars[1]!.y).toBe(20);
    expect(geo.bars[1]!.height).toBe(250);
    expect(geo.bars[1]!.cy).toBe(270);
    expect(geo.bars[0]!.height).toBeCloseTo(125);
  });

  it('keeps every bar inside the plot area', () => {
    const geo = buildTrend(points, BOX);
    for (const bar of geo.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(BOX.left);
      expect(bar.x + bar.width).toBeLessThanOrEqual(BOX.width - BOX.right);
    }
  });

  it('copes with no data and with a single day', () => {
    expect(buildTrend([], BOX).bars).toEqual([]);
    const one = buildTrend([points[0]!], BOX);
    expect(one.bars).toHaveLength(1);
    expect(one.line).toBe('');
  });
});

describe('describeTrend', () => {
  it('summarises totals and the conversion share', () => {
    const text = describeTrend([
      { date: '1 Nov', requests: 10, bookings: 4 },
      { date: '2 Nov', requests: 30, bookings: 16 },
    ]);
    expect(text).toContain('40 ride requests');
    expect(text).toContain('20 bookings');
    expect(text).toContain('50%');
    expect(text).toContain('2 Nov');
  });

  it('says so when there is nothing', () => {
    expect(describeTrend([])).toMatch(/No activity/);
  });
});
