import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { REVIEW_COMMENT_MAX_LENGTH, type Paginated, type Review } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { DriversApi } from '@core/api/public.api';
import { DateOnlyPipe, HumanizePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Reveal } from '@ui/motion';
import { StatePanel } from '@ui/primitives';
import { Pager } from '@ui/status';
import { PartnerStore } from '../partner.store';
import { PartnerHead } from '../shared/page-head';

const EMPTY: Paginated<Review> = { items: [], page: 1, pageSize: 10, total: 0 };

/** What customers wrote about this driver, with one public reply allowed per review. */
@Component({
  selector: 'app-partner-reviews',
  imports: [Icon, StatePanel, Pager, Reveal, DateOnlyPipe, HumanizePipe, PartnerHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-partner-head heading="Reviews" lead="Reviews come only from customers who completed a booking with you. You can post one public reply to each." />

    @switch (reviews.status()) {
      @case ('error') {
        <app-state-panel [error]="reviews.error()" (retry)="reviews.load()" />
      }
      @case ('ready') {
        <ul class="list">
          @for (review of reviews.data()!.items; track review.id; let i = $index) {
            <li class="card rev" appReveal [revealDelay]="i * 50">
              <header class="rev__head">
                <span class="stars" role="img" [attr.aria-label]="review.rating + ' out of 5 stars'">
                  @for (n of stars; track n) {
                    <app-icon name="star" [size]="17" [filled]="n <= review.rating" [class.is-on]="n <= review.rating" />
                  }
                </span>
                <strong>{{ review.authorName }}</strong>
                <span class="subtle">{{ review.tripType | humanize }} · {{ review.createdAt | dateOnly }}</span>
              </header>
              @if (review.comment) {
                <p class="rev__text">{{ review.comment }}</p>
              } @else {
                <p class="subtle">No comment was left.</p>
              }

              @if (review.reply; as reply) {
                <div class="rev__reply">
                  <p class="rev__label">Your reply · {{ reply.at | dateOnly }}</p>
                  <p>{{ reply.text }}</p>
                </div>
              } @else if (replyingTo() === review.id) {
                <form class="rev__form" (submit)="$event.preventDefault(); send(review)" novalidate>
                  <label class="field__label" [for]="'reply-' + review.id">Your public reply</label>
                  <textarea
                    class="textarea"
                    rows="3"
                    [id]="'reply-' + review.id"
                    [attr.maxlength]="max"
                    [value]="draft()"
                    (input)="draft.set($any($event.target).value)"
                    [attr.aria-invalid]="problem() ? 'true' : null"
                    placeholder="Thank the customer, or explain what happened. Be polite — everyone can read this."
                  ></textarea>
                  <p class="field__hint">{{ draft().length }} / {{ max }} · A reply cannot be edited afterwards.</p>
                  @if (problem()) {
                    <p class="field__error" role="alert"><app-icon name="alert-circle" [size]="14" /> {{ problem() }}</p>
                  }
                  <div class="form-actions">
                    <button type="button" class="btn btn--ghost btn--sm" [disabled]="busy()" (click)="cancel()">Cancel</button>
                    <button type="submit" class="btn btn--dark btn--sm" [class.is-loading]="busy()" [disabled]="busy()">Post reply</button>
                  </div>
                </form>
              } @else {
                <button type="button" class="btn btn--outline btn--sm rev__open" (click)="open(review)"><app-icon name="message" [size]="15" /> Reply</button>
              }
            </li>
          } @empty {
            <li><app-state-panel kind="empty" title="No reviews yet" message="After a trip is completed, the customer can rate it. Their reviews appear here and on your public profile." /></li>
          }
        </ul>
        <app-pager [page]="reviews.data()!.page" [pageSize]="reviews.data()!.pageSize" [total]="reviews.data()!.total" (pageChange)="setPage($event)" />
      }
      @default {
        @for (n of [1, 2, 3]; track n) { <span class="skeleton" style="height: 8rem; margin-bottom: 0.75rem; border-radius: var(--r-lg)" aria-hidden="true"></span> }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 52rem;
    }
    .list {
      display: grid;
      gap: var(--s-4);
    }
    .rev {
      display: grid;
      gap: 0.7rem;
    }
    .rev__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.3rem 0.75rem;
    }
    .stars {
      display: inline-flex;
      gap: 0.1rem;
      color: var(--ink-300);
    }
    .stars .is-on {
      color: var(--marigold-500);
      stroke: var(--ink-900);
    }
    .rev__text {
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .rev__reply {
      padding: 0.75rem 0.9rem;
      border-left: 4px solid var(--palm-500);
      border-radius: var(--r-sm);
      background: var(--palm-50);
      overflow-wrap: anywhere;
    }
    .rev__label {
      font-size: var(--fs-xs);
      font-weight: 700;
      color: var(--palm-800);
    }
    .rev__form {
      display: grid;
      gap: 0.4rem;
    }
    .rev__form .form-actions {
      margin-top: 0.3rem;
    }
    .rev__open {
      justify-self: start;
      min-height: 2.75rem;
    }
  `,
})
export class Reviews {
  private readonly driversApi = inject(DriversApi);
  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  private readonly store = inject(PartnerStore);

  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly max = REVIEW_COMMENT_MAX_LENGTH;

  private readonly page = signal(1);
  private readonly profileId = computed(() => this.store.profile.data()?.id ?? null);
  protected readonly reviews = loader(() => this.driversApi.reviews(this.profileId()!, { page: this.page(), pageSize: 10 }));

  protected readonly replyingTo = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly busy = signal(false);
  protected readonly problem = signal('');

  constructor() {
    // Reviews hang off the public driver id, which is the partner profile id.
    effect(() => {
      const known = this.store.profileKnown();
      const id = this.profileId();
      untracked(() => {
        if (id) this.reviews.load();
        else if (known) this.reviews.set(EMPTY);
      });
    });
  }

  protected open(review: Review): void {
    this.replyingTo.set(review.id);
    this.draft.set('');
    this.problem.set('');
  }

  protected cancel(): void {
    this.replyingTo.set(null);
  }

  protected send(review: Review): void {
    const text = this.draft().trim();
    if (this.busy()) return;
    if (text.length < 2) {
      this.problem.set('Write a few words before posting.');
      return;
    }
    this.busy.set(true);
    this.problem.set('');
    this.api.replyToReview(review.id, { text }).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.replyingTo.set(null);
        this.reviews.update((page) => ({ ...page, items: page.items.map((r) => (r.id === updated.id ? updated : r)) }));
        this.toasts.success('Reply posted.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const apiError = toApiError(error);
        this.problem.set(apiError.fieldErrors[0]?.message ?? apiError.problem?.detail ?? apiError.message);
      },
    });
  }

  protected setPage(page: number): void {
    this.page.set(page);
    this.reviews.load();
    window.scrollTo({ top: 0 });
  }
}
