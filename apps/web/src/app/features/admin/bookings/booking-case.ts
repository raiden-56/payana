import { ChangeDetectionStrategy, Component, computed, inject, input, signal, effect, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BookingStatus, Permission, type ResolveDisputeRequest } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { AuthStore } from '@core/auth/auth.store';
import { DateTimePipe, HumanizePipe, MoneyPipe, PhonePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { StatusBadge, statusLabel } from '@ui/status';
import { AdminCounts } from '../admin-layout';

type Outcome = ResolveDisputeRequest['outcome'];

/** A booking as support sees it: read-only, except for resolving a dispute. */
@Component({
  selector: 'app-admin-booking-case',
  imports: [RouterLink, Icon, StatePanel, StatusBadge, DateTimePipe, MoneyPipe, HumanizePipe, PhonePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="a-back" routerLink="/admin/bookings"><app-icon name="arrow-left" [size]="16" /> All bookings</a>

    @switch (booking.status()) {
      @case ('error') {
        <app-state-panel [error]="booking.error()" (retry)="booking.load()" />
      }
      @case ('ready') {
        @let b = booking.data()!;
        <header class="a-head">
          <div>
            <h1 class="a-mono">{{ b.code }}</h1>
            <p class="meta">
              <app-status-badge kind="booking" [value]="b.status" />
              <span>{{ b.tripType | humanize }}</span>
              <span>Booked <time [attr.datetime]="b.createdAt">{{ b.createdAt | dateTime }}</time></span>
            </p>
          </div>
        </header>

        <div class="a-split">
          <div class="a-stack">
            <section class="a-panel" aria-labelledby="trip-title">
              <header><h2 id="trip-title">Trip</h2></header>
              <div class="a-panel__body">
                <div class="route">
                  <span class="route__dot"></span>
                  <div>
                    <p class="route__label">{{ b.pickup.label }}</p>
                    <p class="route__sub">Pickup · <time [attr.datetime]="b.scheduledAt">{{ b.scheduledAt | dateTime }}</time></p>
                  </div>
                  @if (b.drop) {
                    <span class="route__dot route__dot--drop"></span>
                    <div>
                      <p class="route__label">{{ b.drop.label }}</p>
                      <p class="route__sub">Drop{{ b.returnAt ? ' · returning ' + (b.returnAt | dateTime) : '' }}</p>
                    </div>
                  }
                </div>
                <dl class="kv facts">
                  <dt>Passengers</dt>
                  <dd>{{ b.passengers }}</dd>
                  <dt>Luggage</dt>
                  <dd>{{ b.luggage }} bag{{ b.luggage === 1 ? '' : 's' }}</dd>
                  @if (b.packageTitle) {
                    <dt>Package</dt>
                    <dd>{{ b.packageTitle }}</dd>
                  }
                  @if (b.notes) {
                    <dt>Customer's note</dt>
                    <dd>{{ b.notes }}</dd>
                  }
                  @if (b.pickupNote) {
                    <dt>Driver's pickup note</dt>
                    <dd>{{ b.pickupNote }}</dd>
                  }
                </dl>
              </div>
            </section>

            <section class="a-panel" aria-labelledby="fare-title">
              <header><h2 id="fare-title">Fare</h2></header>
              <div class="a-panel__body">
                <dl class="kv">
                  <dt>Quoted by the driver</dt>
                  <dd class="tabular">{{ b.fare.quoted | money }}</dd>
                  <dt>Booking fee</dt>
                  <dd class="tabular">{{ b.fare.bookingFee | money }}</dd>
                  <dt>Total</dt>
                  <dd class="tabular total">{{ b.fare.total | money }}</dd>
                  <dt>Included</dt>
                  <dd>{{ b.inclusions.join(', ') || 'Nothing listed' }}</dd>
                  <dt>Not included</dt>
                  <dd>{{ b.exclusions.join(', ') || 'Nothing listed' }}</dd>
                  <dt>Cancellation policy</dt>
                  <dd>{{ b.cancellationPolicy.summary }}</dd>
                </dl>
                @if (b.cancellation; as x) {
                  <p class="notice notice--danger cancel">
                    <app-icon name="alert-circle" [size]="18" />
                    <span>
                      <strong>Cancelled: {{ x.reason | humanize }}.</strong>
                      {{ x.note }} Fee charged: {{ x.feeCharged | money }}.
                    </span>
                  </p>
                }
              </div>
            </section>

            <section class="a-panel" aria-labelledby="people-title">
              <header><h2 id="people-title">People and vehicle</h2></header>
              <div class="a-panel__body">
                <dl class="kv">
                  <dt>Customer</dt>
                  <dd>{{ b.customer.displayName }}{{ b.customer.phone ? ' · ' + (b.customer.phone | phone) : '' }}</dd>
                  <dt>Driver</dt>
                  <dd>{{ b.driver.displayName }}{{ b.driver.phone ? ' · ' + (b.driver.phone | phone) : '' }}</dd>
                  <dt>Vehicle</dt>
                  <dd>
                    {{ b.vehicle.make }} {{ b.vehicle.model }} · {{ b.vehicle.categoryName }}
                    <span class="a-mono">{{ b.vehicle.registrationNumber }}</span>
                  </dd>
                </dl>
              </div>
            </section>
          </div>

          <aside class="a-stack">
            @if (canResolve && b.status === disputed) {
              <section class="a-panel resolve" aria-labelledby="resolve-title">
                <header><h2 id="resolve-title">Resolve dispute</h2></header>
                <form class="a-panel__body" (submit)="$event.preventDefault(); resolve()" novalidate>
                  <fieldset class="resolve__options">
                    <legend class="field__label">Outcome</legend>
                    <label class="check">
                      <input type="radio" name="outcome" value="completed" [checked]="outcome() === 'completed'" (change)="outcome.set('completed')" />
                      <span><strong>Trip stands as completed</strong><small>The booking closes as a normal completed trip.</small></span>
                    </label>
                    <label class="check">
                      <input type="radio" name="outcome" value="cancelled_by_admin" [checked]="outcome() === 'cancelled_by_admin'" (change)="outcome.set('cancelled_by_admin')" />
                      <span><strong>Cancel the booking</strong><small>The booking closes as cancelled by support.</small></span>
                    </label>
                    @if (tried() && !outcome()) {
                      <p class="field__error"><app-icon name="alert-circle" [size]="14" /> Choose an outcome.</p>
                    }
                  </fieldset>
                  <div class="field">
                    <label class="field__label" for="resolve-note">What was decided, and why</label>
                    <textarea
                      id="resolve-note"
                      class="textarea"
                      rows="4"
                      maxlength="1000"
                      [value]="note()"
                      (input)="note.set($any($event.target).value)"
                      [attr.aria-invalid]="tried() && !note().trim() ? 'true' : null"
                    ></textarea>
                    @if (tried() && !note().trim()) {
                      <p class="field__error"><app-icon name="alert-circle" [size]="14" /> A note is required; both parties and the audit log see it.</p>
                    } @else {
                      <p class="field__hint">Shown to both parties and kept in the audit log.</p>
                    }
                  </div>
                  <button type="submit" class="btn btn--dark btn--block" [class.is-loading]="busy()" [disabled]="busy()">Resolve dispute</button>
                </form>
              </section>
            }

            <section class="a-panel" aria-labelledby="timeline-title">
              <header><h2 id="timeline-title">Timeline</h2></header>
              <div class="a-panel__body">
                <ol class="a-timeline">
                  @for (e of b.timeline; track $index) {
                    <li>
                      <strong>{{ label(e.status) }}</strong>
                      @if (e.note) {
                        <span>{{ e.note }}</span>
                      }
                      <span class="a-timeline__meta">{{ e.actor | humanize }} · <time [attr.datetime]="e.at">{{ e.at | dateTime }}</time></span>
                    </li>
                  } @empty {
                    <li>No events recorded.</li>
                  }
                </ol>
              </div>
            </section>
          </aside>
        </div>
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3]; track n) {
            <span class="skeleton" style="height: 9rem"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading the booking…</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.9rem;
    }
    .facts {
      margin-top: 1.1rem;
      padding-top: 1rem;
      border-top: 1px dashed var(--color-border);
    }
    .total {
      font-size: 1.15rem;
      font-weight: 800;
    }
    .cancel {
      margin-top: 1rem;
    }
    .resolve {
      border-color: var(--ink-900);
      box-shadow: var(--shadow-hard-sm);
    }
    .resolve form {
      display: grid;
      gap: 1rem;
    }
    .resolve__options {
      display: grid;
      gap: 0.6rem;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .resolve__options .check span {
      display: grid;
    }
    .resolve__options small {
      font-size: var(--fs-xs);
      color: var(--color-text-muted);
    }
  `,
})
export class AdminBookingCase {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly counts = inject(AdminCounts);

  protected readonly disputed = BookingStatus.Disputed;
  protected readonly canResolve = this.auth.hasPermission(Permission.BookingsResolve);
  protected readonly booking = loader(() => this.api.booking(this.id()));

  protected readonly outcome = signal<Outcome | null>(null);
  protected readonly note = signal('');
  protected readonly tried = signal(false);
  protected readonly busy = signal(false);
  protected readonly valid = computed(() => !!this.outcome() && !!this.note().trim());

  constructor() {
    // The router sets the id input after construction, and again when moving between records.
    effect(() => {
      this.id();
      untracked(() => this.booking.load());
    });
  }

  protected label(status: string): string {
    return statusLabel('booking', status);
  }

  protected resolve(): void {
    this.tried.set(true);
    const outcome = this.outcome();
    if (!outcome || !this.valid() || this.busy()) return;
    this.busy.set(true);
    this.api.resolveDispute(this.id(), { outcome, note: this.note().trim() }).subscribe({
      next: (updated) => {
        this.booking.set(updated);
        this.busy.set(false);
        this.toasts.success('Dispute resolved.');
        this.counts.refresh();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }
}
