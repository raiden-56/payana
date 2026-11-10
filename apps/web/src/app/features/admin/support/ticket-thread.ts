import { ChangeDetectionStrategy, Component, inject, input, signal, effect, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TicketPriority, TicketStatus, type SupportTicket } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { DateTimePipe, HumanizePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { StatusBadge, statusLabel } from '@ui/status';
import { AdminCounts } from '../admin-layout';

/** One support ticket: the conversation, a reply box, and its status and priority. */
@Component({
  selector: 'app-admin-ticket-thread',
  imports: [RouterLink, Icon, StatePanel, StatusBadge, DateTimePipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="a-back" routerLink="/admin/support"><app-icon name="arrow-left" [size]="16" /> All tickets</a>

    @switch (ticket.status()) {
      @case ('error') {
        <app-state-panel [error]="ticket.error()" (retry)="ticket.load()" />
      }
      @case ('ready') {
        @let t = ticket.data()!;
        <header class="a-head">
          <div>
            <h1>{{ t.subject }}</h1>
            <p class="meta">
              <span class="a-mono">{{ t.reference }}</span>
              <app-status-badge kind="ticket" [value]="t.status" />
              <app-status-badge kind="priority" [value]="t.priority" />
              <span>{{ t.category | humanize }}</span>
            </p>
          </div>
        </header>

        <div class="a-split">
          <section class="a-panel" aria-labelledby="thread-title">
            <header><h2 id="thread-title">Conversation</h2></header>
            <div class="a-panel__body">
              <ol class="a-thread">
                @for (m of t.messages; track m.id) {
                  <li class="a-msg" [class.a-msg--support]="m.author === 'support'">
                    <header>
                      <strong>{{ m.authorName }}</strong>
                      <span>{{ m.author === 'support' ? 'Support' : 'Account holder' }}</span>
                      <time [attr.datetime]="m.createdAt">{{ m.createdAt | dateTime }}</time>
                    </header>
                    <p>{{ m.body }}</p>
                  </li>
                }
              </ol>

              <form class="reply" (submit)="$event.preventDefault(); send()" novalidate>
                <div class="field">
                  <label class="field__label" for="tk-reply">Reply</label>
                  <textarea
                    id="tk-reply"
                    class="textarea"
                    rows="4"
                    maxlength="2000"
                    [value]="reply()"
                    (input)="reply.set($any($event.target).value)"
                    [attr.aria-invalid]="tried() && !reply().trim() ? 'true' : null"
                  ></textarea>
                  @if (tried() && !reply().trim()) {
                    <p class="field__error"><app-icon name="alert-circle" [size]="14" /> Write a reply first.</p>
                  } @else {
                    <p class="field__hint">The account holder is notified. Do not include passwords or one-time codes.</p>
                  }
                </div>
                <button type="submit" class="btn btn--dark" [class.is-loading]="sending()" [disabled]="sending()">
                  <app-icon name="send" [size]="16" /> Send reply
                </button>
              </form>
            </div>
          </section>

          <aside class="a-stack">
            <section class="a-panel" aria-labelledby="triage-title">
              <header><h2 id="triage-title">Triage</h2></header>
              <div class="a-panel__body triage">
                <div class="field">
                  <label class="field__label" for="tk-set-status">Status</label>
                  <select id="tk-set-status" class="select" [disabled]="saving()" (change)="setStatus($any($event.target).value)">
                    @for (s of statuses; track s) {
                      <option [value]="s" [selected]="t.status === s">{{ label(s) }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="tk-set-priority">Priority</label>
                  <select id="tk-set-priority" class="select" [disabled]="saving()" (change)="setPriority($any($event.target).value)">
                    @for (p of priorities; track p) {
                      <option [value]="p" [selected]="t.priority === p">{{ p | humanize }}</option>
                    }
                  </select>
                </div>
                <dl class="kv">
                  <dt>Opened</dt>
                  <dd>{{ t.createdAt | dateTime }}</dd>
                  <dt>Updated</dt>
                  <dd>{{ t.updatedAt | dateTime }}</dd>
                  <dt>Booking</dt>
                  <dd>
                    @if (t.bookingId) {
                      <a class="link a-mono" [routerLink]="['/admin/bookings', t.bookingId]">{{ t.bookingCode || 'Open booking' }}</a>
                    } @else {
                      None linked
                    }
                  </dd>
                </dl>
              </div>
            </section>
          </aside>
        </div>
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3]; track n) {
            <span class="skeleton" style="height: 7rem"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading the ticket…</p>
      }
    }
  `,
  styles: `
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.8rem;
    }
    .reply {
      display: grid;
      gap: 0.75rem;
      justify-items: start;
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px dashed var(--color-border);
    }
    .reply .field {
      width: 100%;
    }
    .triage {
      display: grid;
      gap: 1rem;
    }
  `,
})
export class AdminTicketThread {
  /** Route parameter. */
  readonly id = input.required<string>();

  private readonly api = inject(AdminApi);
  private readonly toasts = inject(ToastService);
  private readonly counts = inject(AdminCounts);

  protected readonly statuses = Object.values(TicketStatus);
  protected readonly priorities = Object.values(TicketPriority);
  protected readonly ticket = loader(() => this.api.ticket(this.id()));

  protected readonly reply = signal('');
  protected readonly tried = signal(false);
  protected readonly sending = signal(false);
  protected readonly saving = signal(false);

  constructor() {
    // The router sets the id input after construction, and again when moving between records.
    effect(() => {
      this.id();
      untracked(() => this.ticket.load());
    });
  }

  protected label(status: string): string {
    return statusLabel('ticket', status);
  }

  protected send(): void {
    this.tried.set(true);
    const body = this.reply().trim();
    if (!body || this.sending()) return;
    this.sending.set(true);
    this.api.replyToTicket(this.id(), { body }).subscribe({
      next: (updated) => {
        this.ticket.set(updated);
        this.reply.set('');
        this.tried.set(false);
        this.sending.set(false);
        this.toasts.success('Reply sent.');
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.toasts.error(error);
      },
    });
  }

  protected setStatus(status: TicketStatus): void {
    this.patch({ status }, `Status set to ${this.label(status).toLowerCase()}.`);
  }

  protected setPriority(priority: TicketPriority): void {
    this.patch({ priority }, `Priority set to ${priority}.`);
  }

  private patch(change: { status?: TicketStatus; priority?: TicketPriority }, message: string): void {
    this.saving.set(true);
    this.api.updateTicket(this.id(), change).subscribe({
      next: (updated: SupportTicket) => {
        this.ticket.set(updated);
        this.saving.set(false);
        this.toasts.success(message);
        this.counts.refresh();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toasts.error(error);
        // Put the selects back to what the server still holds.
        this.ticket.load({ silent: true });
      },
    });
  }
}
