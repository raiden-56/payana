import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { buildTrend, describeTrend, type ChartBox, type TrendPoint } from './chart-scale';

const BOX: ChartBox = { width: 720, height: 270, top: 26, right: 14, bottom: 36, left: 40 };
const dayLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const dayOnly = new Intl.DateTimeFormat('en-IN', { day: 'numeric' });

/**
 * Requests (marigold bars) against bookings (palm line) for the last days.
 * Inline SVG in the brand palette; each series is labelled directly, every
 * mark has a tooltip, and the same numbers are available as a table.
 */
@Component({
  selector: 'app-trend-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure>
      <svg [attr.viewBox]="'0 0 ' + box.width + ' ' + box.height" role="img" [attr.aria-label]="summary()">
        <!-- grid -->
        @for (tick of geo().ticks; track tick.value) {
          <line class="grid" [attr.x1]="box.left" [attr.x2]="box.width - box.right" [attr.y1]="tick.y" [attr.y2]="tick.y" />
          <text class="axis" [attr.x]="box.left - 8" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.value }}</text>
        }

        <!-- requests -->
        @for (bar of geo().bars; track bar.date; let i = $index) {
          <rect class="bar" [style.--i]="i" [attr.x]="bar.x" [attr.y]="bar.y" [attr.width]="bar.width" [attr.height]="bar.height" rx="4">
            <title>{{ label(bar.date) }}: {{ bar.requests }} requests, {{ bar.bookings }} bookings</title>
          </rect>
          @if (i % 2 === 0 || geo().bars.length <= 8) {
            <text class="axis" [attr.x]="bar.cx" [attr.y]="box.height - 12" text-anchor="middle">{{ tickLabel(bar.date, i) }}</text>
          }
        }

        <!-- bookings -->
        @if (geo().line) {
          <path class="line" pathLength="1" [attr.d]="geo().line" />
        }
        @for (bar of geo().bars; track bar.date) {
          <circle class="dot" [attr.cx]="bar.cx" [attr.cy]="bar.cy" r="4.5">
            <title>{{ label(bar.date) }}: {{ bar.bookings }} bookings</title>
          </circle>
        }

        <line class="base" [attr.x1]="box.left" [attr.x2]="box.width - box.right" [attr.y1]="geo().baseline" [attr.y2]="geo().baseline" />
      </svg>

      <figcaption>
        <span class="key"><i class="swatch swatch--bar"></i> Ride requests</span>
        <span class="key"><i class="swatch swatch--line"></i> Bookings</span>
      </figcaption>

      <details class="data">
        <summary>Show these numbers as a table</summary>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th scope="col">Day</th><th scope="col" class="num">Requests</th><th scope="col" class="num">Bookings</th></tr>
            </thead>
            <tbody>
              @for (point of points(); track point.date) {
                <tr>
                  <th scope="row">{{ label(point.date) }}</th>
                  <td class="num">{{ point.requests }}</td>
                  <td class="num">{{ point.bookings }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  `,
  styles: `
    :host {
      display: block;
    }
    figure {
      margin: 0;
      display: grid;
      gap: 0.6rem;
    }
    svg {
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .grid {
      stroke: var(--sand-300);
      stroke-width: 1;
      stroke-dasharray: 3 5;
    }
    .base {
      stroke: var(--ink-900);
      stroke-width: 1.5;
    }
    .axis {
      fill: var(--ink-600);
      font-size: 11.5px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .bar {
      fill: var(--marigold-500);
      stroke: var(--ink-900);
      stroke-width: 1.5;
      transform-box: fill-box;
      transform-origin: bottom;
      animation: grow var(--dur-4) var(--ease-out) both;
      animation-delay: calc(var(--i) * 28ms);
    }
    .bar:hover {
      fill: var(--marigold-300);
    }
    .line {
      fill: none;
      stroke: var(--palm-600);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: draw 900ms var(--ease-out) 350ms forwards;
    }
    .dot {
      fill: var(--sand-0);
      stroke: var(--palm-700);
      stroke-width: 2.5;
    }
    figcaption {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 1.25rem;
      font-size: var(--fs-sm);
      font-weight: 600;
      color: var(--ink-700);
    }
    .key {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }
    .swatch {
      display: inline-block;
    }
    .swatch--bar {
      width: 0.85rem;
      height: 0.85rem;
      border-radius: 3px;
      background: var(--marigold-500);
      border: 1.5px solid var(--ink-900);
    }
    .swatch--line {
      width: 1.5rem;
      height: 0;
      border-top: 3px solid var(--palm-600);
      border-radius: 2px;
    }
    .data {
      font-size: var(--fs-sm);
    }
    .data summary {
      cursor: pointer;
      padding-block: 0.5rem;
      font-weight: 600;
      color: var(--ink-700);
    }
    .data .table {
      min-width: 0;
    }
    @keyframes grow {
      from {
        transform: scaleY(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bar {
        animation: none;
      }
      .line {
        animation: none;
        stroke-dashoffset: 0;
      }
    }
  `,
})
export class TrendChart {
  readonly points = input.required<TrendPoint[]>();

  protected readonly box = BOX;
  protected readonly geo = computed(() => buildTrend(this.points(), BOX));
  protected readonly summary = computed(() => describeTrend(this.points().map((p) => ({ ...p, date: this.label(p.date) }))));

  protected label(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? isoDate : dayLabel.format(d);
  }

  /** Month name on the first tick and whenever the month changes; just the day otherwise. */
  protected tickLabel(isoDate: string, index: number): string {
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return index === 0 || d.getDate() <= 2 ? dayLabel.format(d) : dayOnly.format(d);
  }
}
