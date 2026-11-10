import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { humanize } from '@core/util/format';
import { Icon } from './icon';

/**
 * One vocabulary for every status in the product, so "Pending" is the same
 * colour and wording on the customer, partner and admin sides.
 * Colour is never the only signal: each badge always carries its label.
 */

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary' | 'accent' | 'dark';

export type StatusKind =
  | 'booking'
  | 'request'
  | 'quote'
  | 'verification'
  | 'document'
  | 'listing'
  | 'availability'
  | 'subscription'
  | 'invoice'
  | 'ticket'
  | 'priority'
  | 'user'
  | 'campaign'
  | 'region'
  | 'authorization'
  | 'placement'
  | 'review';

interface StatusDef {
  label: string;
  tone: StatusTone;
}

const S = (label: string, tone: StatusTone): StatusDef => ({ label, tone });

const STATUS: Record<StatusKind, Record<string, StatusDef>> = {
  booking: {
    confirmed: S('Confirmed', 'success'),
    driver_en_route: S('Driver on the way', 'accent'),
    driver_arrived: S('Driver has arrived', 'accent'),
    in_progress: S('Trip in progress', 'primary'),
    completed: S('Completed', 'neutral'),
    cancelled_by_customer: S('Cancelled by customer', 'danger'),
    cancelled_by_driver: S('Cancelled by driver', 'danger'),
    cancelled_by_admin: S('Cancelled by support', 'danger'),
    no_show: S('Customer did not show', 'warning'),
    disputed: S('Under review', 'warning'),
  },
  request: {
    open: S('Waiting for quotes', 'accent'),
    booked: S('Booked', 'success'),
    expired: S('Expired', 'neutral'),
    cancelled: S('Cancelled', 'danger'),
  },
  quote: {
    active: S('Open', 'accent'),
    accepted: S('Accepted', 'success'),
    closed: S('Not chosen', 'neutral'),
    withdrawn: S('Withdrawn', 'neutral'),
    expired: S('Expired', 'neutral'),
  },
  verification: {
    incomplete: S('Not submitted', 'neutral'),
    pending: S('In review', 'warning'),
    approved: S('Verified', 'success'),
    changes_requested: S('Changes needed', 'primary'),
    rejected: S('Rejected', 'danger'),
    suspended: S('Suspended', 'danger'),
  },
  document: {
    pending: S('In review', 'warning'),
    approved: S('Approved', 'success'),
    rejected: S('Rejected', 'danger'),
    expired: S('Expired', 'danger'),
  },
  listing: {
    published: S('Listed', 'success'),
    unlisted: S('Not listed', 'neutral'),
    suspended: S('Taken down', 'danger'),
  },
  availability: {
    available: S('Available', 'success'),
    busy: S('On a trip', 'warning'),
    offline: S('Offline', 'neutral'),
  },
  subscription: {
    active: S('Active', 'success'),
    pending_payment: S('Awaiting payment', 'warning'),
    past_due: S('Payment overdue', 'danger'),
    cancelled: S('Cancelled', 'neutral'),
    expired: S('Expired', 'neutral'),
  },
  invoice: {
    open: S('Unpaid', 'warning'),
    paid: S('Paid', 'success'),
    void: S('Void', 'neutral'),
    refunded: S('Refunded', 'primary'),
  },
  ticket: {
    open: S('Open', 'accent'),
    in_progress: S('In progress', 'primary'),
    waiting_on_user: S('Waiting for you', 'warning'),
    resolved: S('Resolved', 'success'),
    closed: S('Closed', 'neutral'),
  },
  priority: {
    normal: S('Normal', 'neutral'),
    high: S('High', 'warning'),
    urgent: S('Urgent', 'danger'),
  },
  user: {
    active: S('Active', 'success'),
    suspended: S('Suspended', 'danger'),
    deletion_requested: S('Deletion requested', 'warning'),
    deleted: S('Deleted', 'neutral'),
  },
  campaign: {
    draft: S('Draft', 'neutral'),
    scheduled: S('Scheduled', 'accent'),
    running: S('Running', 'success'),
    paused: S('Paused', 'warning'),
    ended: S('Ended', 'neutral'),
  },
  region: {
    live: S('Live', 'success'),
    coming_soon: S('Coming soon', 'warning'),
    hidden: S('Hidden', 'neutral'),
  },
  authorization: {
    invited: S('Invite sent', 'warning'),
    active: S('Authorised', 'success'),
    revoked: S('Revoked', 'danger'),
    expired: S('Expired', 'neutral'),
  },
  placement: {
    scheduled: S('Scheduled', 'accent'),
    active: S('Running', 'success'),
    ended: S('Ended', 'neutral'),
    cancelled: S('Cancelled', 'neutral'),
  },
  review: {
    published: S('Published', 'success'),
    hidden: S('Hidden', 'danger'),
  },
};

export function statusLabel(kind: StatusKind, value: string | null | undefined): string {
  if (!value) return '—';
  return STATUS[kind][value]?.label ?? humanize(value);
}

export function statusTone(kind: StatusKind, value: string | null | undefined): StatusTone {
  return (value && STATUS[kind][value]?.tone) || 'neutral';
}

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"badge badge--" + tone()' },
  template: `{{ label() }}`,
  styles: `
    :host.badge--neutral {
      --badge-bg: var(--sand-200);
      --badge-fg: var(--ink-700);
    }
  `,
})
export class StatusBadge {
  readonly kind = input.required<StatusKind>();
  readonly value = input.required<string | null | undefined>();

  protected readonly label = computed(() => statusLabel(this.kind(), this.value()));
  protected readonly tone = computed(() => statusTone(this.kind(), this.value()));
}

/** Previous / next paging for lists that come back as Paginated<T>. */
@Component({
  selector: 'app-pager',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[hidden]': 'pages() <= 1' },
  template: `
    <nav class="pager" aria-label="Pages">
      <button type="button" class="btn btn--outline btn--sm" [disabled]="page() <= 1" (click)="pageChange.emit(page() - 1)">
        <app-icon name="chevron-left" [size]="16" /> Previous
      </button>
      <span class="pager__info" aria-live="polite">Page {{ page() }} of {{ pages() }} · {{ total() }} in all</span>
      <button type="button" class="btn btn--outline btn--sm" [disabled]="page() >= pages()" (click)="pageChange.emit(page() + 1)">
        Next <app-icon name="chevron-right" [size]="16" />
      </button>
    </nav>
  `,
  styles: `
    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 0.75rem 1.25rem;
      margin-top: var(--s-6);
    }
    .pager__info {
      font-size: var(--fs-sm);
      color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Pager {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly pageChange = output<number>();

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / Math.max(1, this.pageSize()))));
}
