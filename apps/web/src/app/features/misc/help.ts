import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TicketCategory } from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { SupportApi } from '@core/api/customer.api';
import { AuthStore } from '@core/auth/auth.store';
import { AppConfigService } from '@core/config/app-config.service';
import { RelativeTimePipe, formatPhone, humanize } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';

const CATEGORIES: TicketCategory[] = [
  TicketCategory.BookingIssue,
  TicketCategory.FareDispute,
  TicketCategory.RefundRequest,
  TicketCategory.Safety,
  TicketCategory.Account,
  TicketCategory.Subscription,
  TicketCategory.AbuseReport,
  TicketCategory.Other,
];

/** Help centre: contact options, a support form, and (signed in) your tickets with their replies. */
@Component({
  selector: 'app-help',
  imports: [ReactiveFormsModule, RouterLink, Icon, StatePanel, StatusBadge, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <div class="container layout">
        <div class="main">
          <header class="page-head">
            <span class="eyebrow">Help centre</span>
            <h1>How can we help?</h1>
            <p>For a problem with a specific trip, the quickest route is “Report a problem” on the booking itself.</p>
          </header>

          <p class="notice notice--danger"><app-icon name="alert" [size]="18" /> <span>In an emergency call <strong>112</strong>. Support is not an emergency service.</span></p>

          @if (auth.isAuthenticated()) {
            <form class="panel" [formGroup]="form" (submit)="$event.preventDefault(); send()" novalidate>
              <header class="panel__head"><h2>Write to support</h2></header>
              <div class="panel__body stack">
                <div class="field">
                  <label class="field__label" for="h-cat">Topic</label>
                  <select id="h-cat" class="select" formControlName="category">
                    @for (c of categories; track c) { <option [value]="c">{{ humanize(c) }}</option> }
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="h-sub">Subject</label>
                  <input id="h-sub" class="input" maxlength="120" formControlName="subject" [attr.aria-invalid]="form.controls.subject.touched && form.controls.subject.invalid ? 'true' : null" />
                  @if (form.controls.subject.touched && form.controls.subject.invalid) {
                    <p class="field__error"><app-icon name="alert-circle" [size]="14" /> Add a short subject.</p>
                  }
                </div>
                <div class="field">
                  <label class="field__label" for="h-body">Message</label>
                  <textarea id="h-body" class="textarea" rows="5" maxlength="2000" formControlName="body" [attr.aria-invalid]="form.controls.body.touched && form.controls.body.invalid ? 'true' : null"></textarea>
                  @if (form.controls.body.touched && form.controls.body.invalid) {
                    <p class="field__error"><app-icon name="alert-circle" [size]="14" /> Tell us a little more (at least 10 characters).</p>
                  }
                </div>
                <div class="form-actions">
                  <button type="submit" class="btn btn--dark" [class.is-loading]="sending()" [disabled]="sending()">Send</button>
                </div>
              </div>
            </form>

            <section class="panel">
              <header class="panel__head"><h2>Your requests</h2></header>
              <div class="panel__body">
                @switch (tickets.status()) {
                  @case ('error') { <app-state-panel [error]="tickets.error()" (retry)="tickets.load()" /> }
                  @case ('ready') {
                    @if (tickets.data()!.items.length) {
                      <ul class="tickets">
                        @for (t of tickets.data()!.items; track t.id) {
                          <li>
                            <details>
                              <summary>
                                <span class="tabular ref">{{ t.reference }}</span>
                                <strong>{{ t.subject }}</strong>
                                <app-status-badge kind="ticket" [value]="t.status" />
                              </summary>
                              <ol class="thread">
                                @for (m of t.messages; track m.id) {
                                  <li [class.from-support]="m.author === 'support'">
                                    <small>{{ m.author === 'support' ? 'Support' : 'You' }} · {{ m.createdAt | relativeTime }}</small>
                                    <p>{{ m.body }}</p>
                                  </li>
                                }
                              </ol>
                            </details>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="muted">You have not contacted support yet.</p>
                    }
                  }
                  @default { <span class="skeleton" style="height: 4rem"></span> }
                }
              </div>
            </section>
          } @else {
            <app-state-panel kind="info" title="Sign in to write to support" message="So we can see your trips and reply to you.">
              <a routerLink="/sign-in" [queryParams]="{ returnUrl: '/help' }" class="btn btn--dark btn--sm">Sign in</a>
            </app-state-panel>
          }
        </div>

        <aside class="side card card--poster">
          <h2>Other ways to reach us</h2>
          @if (phone() || whatsapp() || config.support().email) {
            <ul class="ways">
              @if (phone()) { <li><a [href]="'tel:' + config.support().phone"><app-icon name="phone" [size]="18" /> {{ phone() }}</a></li> }
              @if (whatsapp()) { <li><a [href]="whatsapp()" target="_blank" rel="noopener noreferrer"><app-icon name="message" [size]="18" /> WhatsApp</a></li> }
              @if (config.support().email) { <li><a [href]="'mailto:' + config.support().email"><app-icon name="send" [size]="18" /> {{ config.support().email }}</a></li> }
            </ul>
          } @else {
            <p class="muted">Phone and WhatsApp support details will be published here. Until then, use the form.</p>
          }
        </aside>
      </div>
    </section>
  `,
  styles: `
    .layout { display: grid; gap: var(--s-6); align-items: start; }
    @media (min-width: 64rem) { .layout { grid-template-columns: minmax(0, 1fr) 20rem; gap: var(--s-10); } .side { position: sticky; top: calc(var(--header-h) + 1.25rem); } }
    .main { display: grid; gap: var(--s-5); min-width: 0; }
    .panel h2, .side h2 { font-size: 1.2rem; }
    .side { display: grid; gap: var(--s-3); }
    .ways { display: grid; gap: 0.6rem; }
    .ways a { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 650; }
    .ways a:hover { color: var(--laterite-600); }
    .tickets { display: grid; gap: 0.5rem; }
    .tickets details { border: 1px solid var(--sand-300); border-radius: var(--r-sm); background: var(--sand-50); }
    .tickets summary { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.8rem; padding: 0.7rem 0.9rem; cursor: pointer; }
    .tickets summary strong { flex: 1; min-width: 10rem; }
    .ref { font-size: var(--fs-xs); font-weight: 700; color: var(--ink-600); }
    .thread { display: grid; gap: 0.5rem; padding: 0 0.9rem 0.9rem; }
    .thread li { padding: 0.6rem 0.8rem; border-radius: var(--r-sm); background: var(--sand-0); }
    .thread .from-support { background: var(--palm-50); border-left: 3px solid var(--palm-500); }
    .thread small { color: var(--color-text-subtle); }
  `,
})
export class Help {
  private readonly api = inject(SupportApi);
  private readonly toasts = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  protected readonly auth = inject(AuthStore);
  protected readonly config = inject(AppConfigService);

  protected readonly categories = CATEGORIES;
  protected readonly humanize = humanize;
  protected readonly sending = signal(false);
  protected readonly tickets = loader(() => this.api.tickets({ pageSize: 20 }));
  protected readonly phone = computed(() => formatPhone(this.config.support().phone));
  protected readonly whatsapp = computed(() => {
    const n = this.config.support().whatsapp.replace(/\D/g, '');
    return n ? `https://wa.me/${n}` : '';
  });

  protected readonly form = new FormGroup({
    category: new FormControl<TicketCategory>(TicketCategory.BookingIssue, { nonNullable: true }),
    subject: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(10), Validators.maxLength(2000)] }),
  });

  constructor() {
    if (this.auth.isAuthenticated()) this.tickets.load();
  }

  protected send(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.sending()) return;
    const v = this.form.getRawValue();
    this.sending.set(true);
    this.api.create({ category: v.category, subject: v.subject.trim(), body: v.body.trim() }).subscribe({
      next: (ticket) => {
        this.sending.set(false);
        this.analytics.track('contact_support', { source: 'help', category: v.category });
        this.form.reset({ category: TicketCategory.BookingIssue, subject: '', body: '' });
        this.toasts.success(`Sent. Your reference is ${ticket.reference}.`);
        this.tickets.load({ silent: true });
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.toasts.error(error);
      },
    });
  }
}
