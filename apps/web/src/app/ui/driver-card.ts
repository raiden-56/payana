import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvailabilityStatus, LocationFreshness, type DriverListing } from '@payana/contracts';
import { compass, formatDistance, formatMoney, formatRelative } from '@core/util/format';
import { Icon } from './icon';
import { Avatar, Rating } from './primitives';
import { VehicleArt } from './vehicle-art';

/** One driver in search results. The whole card links to the profile; "Get a quote" is the primary action. */
@Component({
  selector: 'app-driver-card',
  imports: [RouterLink, Icon, Avatar, Rating, VehicleArt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'spin-wheels', '[class.is-highlighted]': 'highlighted()' },
  template: `
    @let d = driver();
    <article class="dcard">
      <div class="art">
        <app-vehicle-art [icon]="d.vehicle.icon" />
        @if (d.isFeatured) {
          <span class="badge badge--accent featured" title="This driver paid for a featured placement">
            <app-icon name="sparkle" [size]="12" /> Featured
          </span>
        }
      </div>

      <div class="body">
        <header class="head">
          <app-avatar [name]="d.displayName" [photoUrl]="d.photoUrl" [size]="46" />
          <div class="who">
            <h3>
              <a [routerLink]="['/drivers', d.driverId]" class="stretched">{{ d.displayName }}</a>
              @if (d.isVerified) {
                <app-icon class="verified" name="shield-check" [size]="18" label="Verified driver" />
              }
            </h3>
            <div class="meta">
              <app-rating [rating]="d.rating" />
              @if (d.completedTrips > 0) {
                <span class="sep" aria-hidden="true">·</span>
                <span>{{ d.completedTrips }} trips</span>
              }
              @if (d.planBadge) {
                <span class="badge badge--outline">{{ d.planBadge }}</span>
              }
            </div>
          </div>
        </header>

        <p class="vehicle">
          <strong>{{ d.vehicle.categoryName }}</strong>
          <span>{{ d.vehicle.make }} {{ d.vehicle.model }}</span>
        </p>

        <ul class="facts">
          <li><app-icon name="users" [size]="15" /> {{ d.vehicle.seats }} seats</li>
          @if (d.vehicle.luggageCapacity > 0) {
            <li><app-icon name="luggage" [size]="15" /> {{ d.vehicle.luggageCapacity }} {{ d.vehicle.luggageCapacity === 1 ? 'bag' : 'bags' }}</li>
          }
          @if (d.vehicle.hasAc) {
            <li><app-icon name="snowflake" [size]="15" /> AC</li>
          }
          @if (d.languages.length) {
            <li><app-icon name="globe" [size]="15" /> {{ d.languages.slice(0, 3).join(', ') }}</li>
          }
        </ul>

        <footer class="foot">
          <p class="where" [class.where--stale]="isStale()">
            <span class="dot" [class.dot--live]="isAvailable()" [class.dot--off]="!isAvailable()"></span>
            <span>{{ whereText() }}</span>
          </p>
          <div class="bottom">
            <div class="price">
              <span class="price__label">from</span>
              <strong>{{ perKm() }}</strong>
              <span class="price__unit">/km</span>
            </div>
            <a
              class="btn btn--dark btn--sm cta"
              [routerLink]="['/request']"
              [queryParams]="{ driver: d.driverId, category: d.vehicle.categoryCode }"
            >
              Get a quote <app-icon class="btn__arrow" name="arrow-right" [size]="16" />
            </a>
          </div>
        </footer>
      </div>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .dcard {
      position: relative;
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      background: var(--color-surface);
      border: var(--stroke) solid var(--color-border);
      border-radius: var(--r-lg);
      overflow: hidden;
      transition:
        transform var(--dur-3) var(--ease-out),
        box-shadow var(--dur-3) var(--ease-out),
        border-color var(--dur-2) var(--ease-out);
    }
    @media (hover: hover) and (pointer: fine) {
      .dcard:hover {
        transform: translateY(-4px);
        border-color: var(--ink-900);
        box-shadow: var(--shadow-md);
      }
    }
    :host(.is-highlighted) .dcard {
      border-color: var(--ink-900);
      box-shadow: var(--shadow-hard);
    }
    .art {
      position: relative;
    }
    .art app-vehicle-art {
      --vehicle-radius: 0;
      aspect-ratio: 16 / 10;
    }
    .featured {
      position: absolute;
      top: 0.65rem;
      left: 0.65rem;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      padding: 1rem 1.1rem 1.1rem;
    }
    .head {
      display: flex;
      gap: 0.7rem;
      align-items: center;
      min-width: 0;
    }
    .who {
      min-width: 0;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 1.12rem;
      line-height: 1.2;
    }
    h3 a {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Makes the whole card clickable while keeping one real link for screen readers. */
    .stretched::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 1;
    }
    .verified {
      color: var(--palm-600);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      font-size: var(--fs-sm);
      color: var(--color-text-subtle);
    }
    .vehicle {
      display: flex;
      flex-wrap: wrap;
      gap: 0.15rem 0.5rem;
      align-items: baseline;
    }
    .vehicle span {
      color: var(--color-text-muted);
      font-size: var(--fs-sm);
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem 0.9rem;
      font-size: var(--fs-sm);
      color: var(--ink-700);
    }
    .facts li {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .facts app-icon {
      color: var(--ink-500);
    }
    .foot {
      display: grid;
      gap: 0.7rem;
      margin-top: auto;
      padding-top: 0.75rem;
      border-top: 1px dashed var(--color-border);
    }
    .where {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      font-size: var(--fs-sm);
      font-weight: 600;
      min-width: 0;
    }
    .where .dot {
      translate: 0 -0.05rem;
    }
    .bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .where--stale {
      font-weight: 400;
      color: var(--color-text-subtle);
    }
    .dot--off {
      color: var(--ink-300);
    }
    .price {
      display: flex;
      align-items: baseline;
      gap: 0.2rem;
      white-space: nowrap;
    }
    .price strong {
      font-size: 1.3rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .price__label,
    .price__unit {
      font-size: var(--fs-xs);
      color: var(--color-text-subtle);
    }
    .cta {
      position: relative;
      z-index: 2;
    }
  `,
})
export class DriverCard {
  readonly driver = input.required<DriverListing>();
  readonly highlighted = input(false);

  protected readonly isAvailable = computed(() => this.driver().availability === AvailabilityStatus.Available);

  protected readonly hasFreshLocation = computed(() => {
    const f = this.driver().location.freshness;
    return f === LocationFreshness.Live || f === LocationFreshness.Recent;
  });

  protected readonly perKm = computed(() => formatMoney(this.driver().rates.perKm));

  /**
   * Says only what is actually known. A stale position is never presented as
   * a current distance (constitution §2.8).
   */
  protected readonly isStale = computed(() => this.driver().location.freshness === LocationFreshness.Stale);

  protected readonly whereText = computed(() => {
    const d = this.driver();
    const { freshness, distanceKm, bearingDeg, updatedAt } = d.location;
    const status =
      d.availability === AvailabilityStatus.Available
        ? 'Available now'
        : d.availability === AvailabilityStatus.Busy
          ? 'On a trip'
          : 'Offline';

    // A distance exists only when the search had a pickup point AND the fix is fresh.
    if (this.hasFreshLocation() && distanceKm !== null) {
      const direction = compass(bearingDeg);
      const approx = freshness === LocationFreshness.Recent ? 'about ' : '';
      return `${status} · ${approx}${formatDistance(distanceKm)}${direction ? ' ' + direction : ''}`;
    }
    if (freshness === LocationFreshness.Stale && updatedAt) {
      return `${status} · last seen ${formatRelative(updatedAt)}`;
    }
    return status;
  });
}
