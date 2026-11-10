import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ErrorCode, QuoteStatus, TripType } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { DateTimePipe, DistancePipe, DurationPipe, MoneyPipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Modal, StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { PartnerStore } from '../partner.store';
import { TRIP_TYPE } from '../shared/labels';
import { PartnerHead } from '../shared/page-head';
import { pollWhileVisible } from '../shared/poll';
import { QuoteForm } from './quote-form';

/** One ride request: the trip on the left, the driver's quote (or the form to send one) on the right. */
@Component({
  selector: 'app-partner-request-detail',
  imports: [RouterLink, Icon, StatePanel, StatusBadge, Modal, PartnerHead, QuoteForm, MoneyPipe, DistancePipe, DurationPipe, DateTimePipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(PartnerApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PartnerStore);

  protected readonly request = loader(() => this.api.request(this.id()));
  protected readonly busy = signal(false);
  protected readonly confirmDecline = signal(false);

  protected readonly item = computed(() => this.request.data());
  protected readonly trip = computed(() => (this.item() ? TRIP_TYPE[this.item()!.tripType] : null));
  protected readonly isNow = computed(() => this.item()?.tripType === TripType.Immediate || !this.item()?.scheduledAt);
  protected readonly category = computed(() => {
    const code = this.item()?.categoryCode ?? '';
    return this.store.categoryByCode().get(code)?.name ?? code;
  });
  protected readonly locked = computed(() => this.request.error()?.code === ErrorCode.DriverNotVerified);
  /** No standing quote from this driver: show the form. */
  protected readonly canQuote = computed(() => {
    const status = this.item()?.myQuote?.status;
    return !status || status === QuoteStatus.Withdrawn || status === QuoteStatus.Expired;
  });
  protected readonly quoteActive = computed(() => this.item()?.myQuote?.status === QuoteStatus.Active);

  constructor() {
    // Load when the route parameter arrives, and again if it changes.
    effect(() => {
      this.id();
      untracked(() => this.request.load());
    });
    pollWhileVisible(() => {
      if (this.request.status() === 'ready') this.request.load({ silent: true });
    }, 15_000);
  }

  protected withdraw(): void {
    const quote = this.item()?.myQuote;
    if (!quote || this.busy()) return;
    this.busy.set(true);
    this.api.withdrawQuote(quote.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.info('Quote withdrawn.');
        this.request.load({ silent: true });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(toApiError(error));
        this.request.load({ silent: true });
      },
    });
  }

  protected decline(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.declineRequest(this.id()).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmDecline.set(false);
        this.toasts.info('Request removed from your inbox.');
        void this.router.navigateByUrl('/partner/requests');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirmDecline.set(false);
        this.toasts.error(toApiError(error));
      },
    });
  }
}
