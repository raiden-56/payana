import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { Modal } from '@ui/primitives';

let nextId = 0;

/**
 * Confirmation for actions that are destructive or hard to undo. The dialog
 * names exactly what will change, and can require a written reason (which
 * goes to the audit log) before the confirm button works.
 *
 *   <app-admin-confirm
 *     [open]="!!target()" title="Suspend account" confirmLabel="Suspend" tone="danger"
 *     reasonLabel="Reason" [reasonRequired]="true" [busy]="busy()"
 *     (confirmed)="suspend($event)" (cancelled)="target.set(null)">
 *     Suspend <strong>{{ target()?.name }}</strong>? They will be signed out…
 *   </app-admin-confirm>
 */
@Component({
  selector: 'app-admin-confirm',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" [title]="title()" (closed)="cancelled.emit()">
      <div class="confirm">
        <p class="confirm__text"><ng-content /></p>
        @if (reasonLabel()) {
          <div class="field">
            <label class="field__label" [for]="reasonId">
              {{ reasonLabel() }}
              @if (!reasonRequired()) {
                <span class="field__optional">(optional)</span>
              }
            </label>
            <textarea
              class="textarea"
              rows="3"
              [id]="reasonId"
              [value]="reason()"
              (input)="reason.set($any($event.target).value)"
              [attr.aria-invalid]="showMissing() ? 'true' : null"
              [attr.aria-describedby]="reasonId + '-help'"
              maxlength="500"
            ></textarea>
            <p class="field__hint" [class.field__error]="showMissing()" [id]="reasonId + '-help'">
              {{ showMissing() ? 'Write a short reason to continue.' : 'Recorded in the audit log.' }}
            </p>
          </div>
        }
      </div>
      <ng-container modalActions>
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="cancelled.emit()">Cancel</button>
        <button
          type="button"
          class="btn"
          [class.btn--danger]="tone() === 'danger'"
          [class.btn--dark]="tone() !== 'danger'"
          [class.is-loading]="busy()"
          [disabled]="busy()"
          (click)="confirm()"
        >
          {{ confirmLabel() }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .confirm {
      display: grid;
      gap: 1rem;
    }
    .confirm__text {
      color: var(--ink-800);
    }
  `,
})
export class ConfirmDialog {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly tone = input<'danger' | 'dark'>('dark');
  /** When set, a reason box is shown under the message. */
  readonly reasonLabel = input('');
  readonly reasonRequired = input(false);
  readonly busy = input(false);

  /** Emits the trimmed reason ('' when none was asked for). */
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  protected readonly reasonId = `confirm-reason-${nextId++}`;
  protected readonly reason = signal('');
  private readonly tried = signal(false);
  protected readonly showMissing = computed(
    () => this.tried() && this.reasonRequired() && !this.reason().trim(),
  );

  constructor() {
    // Each time the dialog opens it starts clean.
    effect(() => {
      if (this.open()) {
        this.reason.set('');
        this.tried.set(false);
      }
    });
  }

  protected confirm(): void {
    this.tried.set(true);
    if (this.reasonRequired() && !this.reason().trim()) return;
    this.confirmed.emit(this.reason().trim());
  }
}
