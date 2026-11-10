/**
 * Geometry for the overview trend chart: requests as bars, bookings as a line,
 * on one shared vertical scale. Pure functions - see chart-scale.spec.ts.
 */

export interface TrendPoint {
  date: string;
  requests: number;
  bookings: number;
}

export interface ChartBox {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TrendBar {
  date: string;
  requests: number;
  bookings: number;
  /** Bar rectangle for requests. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centre of the band, and the point for the bookings line. */
  cx: number;
  cy: number;
}

export interface TrendGeometry {
  bars: TrendBar[];
  /** SVG path for the bookings line. Empty with fewer than two points. */
  line: string;
  /** Horizontal grid lines, bottom to top. */
  ticks: { value: number; y: number }[];
  max: number;
  baseline: number;
}

/** The smallest "round" number (1, 2, 2.5, 5 × 10ⁿ) that is ≥ value; never below 4 so tiny counts still get whole ticks. */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 4) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / magnitude;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return step * magnitude;
}

export function buildTrend(points: readonly TrendPoint[], box: ChartBox): TrendGeometry {
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;
  const baseline = box.top + plotHeight;
  const peak = points.reduce((m, p) => Math.max(m, p.requests, p.bookings), 0);
  const max = niceCeiling(peak);
  const scaleY = (value: number) => baseline - (Math.max(0, value) / max) * plotHeight;

  const band = points.length ? plotWidth / points.length : plotWidth;
  const barWidth = Math.min(34, band * 0.56);

  const bars: TrendBar[] = points.map((p, i) => {
    const cx = box.left + band * (i + 0.5);
    const y = scaleY(p.requests);
    return {
      date: p.date,
      requests: p.requests,
      bookings: p.bookings,
      x: cx - barWidth / 2,
      y,
      width: barWidth,
      height: baseline - y,
      cx,
      cy: scaleY(p.bookings),
    };
  });

  const line =
    bars.length > 1 ? bars.map((b, i) => `${i ? 'L' : 'M'}${b.cx.toFixed(1)} ${b.cy.toFixed(1)}`).join('') : '';

  const ticks = [0, 0.5, 1].map((f) => ({ value: max * f, y: scaleY(max * f) }));

  return { bars, line, ticks, max, baseline };
}

/** One sentence that says what the chart shows, for people who cannot see it. */
export function describeTrend(points: readonly TrendPoint[]): string {
  if (!points.length) return 'No activity recorded in this period.';
  const requests = points.reduce((s, p) => s + p.requests, 0);
  const bookings = points.reduce((s, p) => s + p.bookings, 0);
  const busiest = points.reduce((best, p) => (p.requests > best.requests ? p : best), points[0]!);
  const share = requests > 0 ? Math.round((bookings / requests) * 100) : null;
  return (
    `Over the last ${points.length} days there were ${requests} ride requests and ${bookings} bookings` +
    (share === null ? '.' : `, so about ${share}% of requests became bookings.`) +
    (busiest.requests > 0 ? ` The busiest day was ${busiest.date} with ${busiest.requests} requests.` : '')
  );
}
