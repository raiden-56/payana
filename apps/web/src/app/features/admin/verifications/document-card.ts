import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DocumentStatus, type AdminDocument } from '@payana/contracts';
import { DateOnlyPipe, DateTimePipe } from '@core/util/format';
import { Icon } from '@ui/icon';
import { StatusBadge } from '@ui/status';
import { daysUntil } from '../shared/forms';
import { DOCUMENT_LABEL, REJECTION_LABEL } from './labels';

/** One submitted document as the verification officer sees it. */
@Component({
  selector: 'app-admin-document-card',
  imports: [Icon, StatusBadge, DateOnlyPipe, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = doc();
    <article class="doc" [class.doc--pending]="d.status === 'pending'">
      <header>
        <h4>{{ label() }}</h4>
        <app-status-badge kind="document" [value]="d.status" />
      </header>

      <dl class="kv">
        <dt>Number</dt>
        <dd class="a-mono">{{ d.documentNumber || 'Not given' }}</dd>
        <dt>Expires</dt>
        <dd>
          @if (d.expiresOn) {
            <time [attr.datetime]="d.expiresOn">{{ d.expiresOn | dateOnly }}</time>
            @if (expiry(); as e) {
              <span [class.a-danger]="e.tone === 'danger'" [class.a-warn]="e.tone === 'warn'"> · {{ e.text }}</span>
            }
          } @else {
            No expiry date
          }
        </dd>
        <dt>Submitted</dt>
        <dd><time [attr.datetime]="d.submittedAt">{{ d.submittedAt | dateTime }}</time></dd>
        @if (d.reviewedAt) {
          <dt>Reviewed</dt>
          <dd>{{ d.reviewedAt | dateTime }}{{ d.reviewedBy ? ' by ' + d.reviewedBy : '' }}</dd>
        }
        @if (d.rejectionReason) {
          <dt>Rejected because</dt>
          <dd>{{ rejectionLabel[d.rejectionReason] }}</dd>
        }
        @if (d.reviewerNote) {
          <dt>Note</dt>
          <dd>{{ d.reviewerNote }}</dd>
        }
      </dl>

      @if (isImage()) {
        <details class="doc__preview">
          <summary><app-icon name="image" [size]="16" /> Preview</summary>
          <img [src]="d.fileUrl" [alt]="label() + ' as uploaded'" loading="lazy" decoding="async" />
        </details>
      }

      <footer>
        <a class="btn btn--outline btn--sm" [href]="d.fileUrl" target="_blank" rel="noopener noreferrer">
          <app-icon name="external" [size]="15" /> Open file
          <span class="visually-hidden">({{ label() }}, opens in a new tab)</span>
        </a>
        @if (canReview() && d.status !== 'approved') {
          <button type="button" class="btn btn--dark btn--sm" [disabled]="busy()" (click)="approve.emit(d)">
            <app-icon name="check" [size]="15" /> Approve
          </button>
        }
        @if (canReview() && d.status !== 'rejected') {
          <button type="button" class="btn btn--soft btn--sm" [disabled]="busy()" (click)="reject.emit(d)">Reject…</button>
        }
      </footer>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .doc {
      display: grid;
      gap: 0.75rem;
      height: 100%;
      align-content: start;
      padding: 1rem;
      border: var(--stroke) solid var(--color-border);
      border-radius: var(--r-md);
      background: var(--sand-0);
    }
    /* Waiting for a decision: a marigold spine, plus the "In review" badge. */
    .doc--pending {
      border-left: 5px solid var(--marigold-500);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem 0.75rem;
    }
    h4 {
      font-size: 1.05rem;
    }
    .kv {
      grid-template-columns: minmax(6.5rem, 0.45fr) 1fr;
    }
    .doc__preview summary {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.75rem;
      cursor: pointer;
      font-size: var(--fs-sm);
      font-weight: 650;
    }
    .doc__preview img {
      width: 100%;
      max-height: 26rem;
      object-fit: contain;
      border: var(--stroke) solid var(--color-border);
      border-radius: var(--r-sm);
      background: var(--sand-100);
    }
    footer {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px dashed var(--color-border);
    }
    footer .btn--sm {
      min-height: 2.75rem;
    }
  `,
})
export class DocumentCard {
  readonly doc = input.required<AdminDocument>();
  readonly canReview = input(false);
  readonly busy = input(false);
  readonly approve = output<AdminDocument>();
  readonly reject = output<AdminDocument>();

  protected readonly rejectionLabel = REJECTION_LABEL;
  protected readonly label = computed(() => DOCUMENT_LABEL[this.doc().type] ?? this.doc().type);
  protected readonly isImage = computed(() => this.doc().contentType.startsWith('image/'));

  /** Words as well as colour, so an expiry problem is never signalled by colour alone. */
  protected readonly expiry = computed<{ text: string; tone: 'danger' | 'warn' | 'ok' } | null>(() => {
    const days = daysUntil(this.doc().expiresOn);
    if (days === null) return null;
    if (days < 0 || this.doc().status === DocumentStatus.Expired) {
      return { text: `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`, tone: 'danger' };
    }
    if (days === 0) return { text: 'expires today', tone: 'danger' };
    if (days <= 30) return { text: `expires in ${days} day${days === 1 ? '' : 's'}`, tone: 'warn' };
    return null;
  });
}
