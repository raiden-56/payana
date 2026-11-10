import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { AuditLogEntry } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { DateTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { Pager } from '@ui/status';

const PAGE_SIZE = 30;

/** The audit trail: who did what, to what, and when. Read-only by design. */
@Component({
  selector: 'app-admin-audit',
  imports: [Icon, StatePanel, Pager, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="a-head">
      <div>
        <h1>Audit log</h1>
        <p>Every administrative action, sign-in failure, verification decision and settings change. Entries cannot be edited.</p>
      </div>
    </header>

    <form class="a-filters" role="search" (submit)="$event.preventDefault(); apply()">
      <div class="field">
        <label class="field__label" for="au-action">Action</label>
        <input id="au-action" class="input" placeholder="e.g. document.approved" [value]="action()" (input)="action.set($any($event.target).value)" />
      </div>
      <div class="field">
        <label class="field__label" for="au-target">Target type</label>
        <input id="au-target" class="input" placeholder="e.g. driver_profile" [value]="targetType()" (input)="targetType.set($any($event.target).value)" />
      </div>
      <div class="field">
        <label class="field__label" for="au-actor">Actor ID</label>
        <input id="au-actor" class="input a-mono" placeholder="User ID" [value]="actorId()" (input)="actorId.set($any($event.target).value)" />
      </div>
      <div class="field">
        <label class="field__label" for="au-from">From</label>
        <input id="au-from" class="input" type="date" [value]="from()" [max]="to() || null" (change)="from.set($any($event.target).value)" />
      </div>
      <div class="field">
        <label class="field__label" for="au-to">To</label>
        <input id="au-to" class="input" type="date" [value]="to()" [min]="from() || null" (change)="to.set($any($event.target).value)" />
      </div>
      <div class="a-filters__actions">
        <button type="submit" class="btn btn--dark"><app-icon name="filter" [size]="16" /> Filter</button>
        @if (action() || targetType() || actorId() || from() || to()) {
          <button type="button" class="btn btn--ghost" (click)="clear()">Clear</button>
        }
      </div>
    </form>

    @switch (logs.status()) {
      @case ('error') {
        <app-state-panel [error]="logs.error()" (retry)="logs.load()" />
      }
      @case ('ready') {
        @let page = logs.data()!;
        @if (page.items.length) {
          <div class="table-wrap table-wrap--stack table-wrap--tall">
            <table class="table">
              <caption class="visually-hidden">Audit log entries</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                @for (e of page.items; track e.id) {
                  <tr>
                    <td data-label="When"><time [attr.datetime]="e.at">{{ e.at | dateTime }}</time></td>
                    <td data-label="Who">
                      {{ e.actorLabel }}
                      @if (e.ip) {
                        <small class="a-mono">{{ e.ip }}</small>
                      }
                    </td>
                    <td data-label="Action"><span class="a-mono action">{{ e.action }}</span></td>
                    <td data-label="Target">
                      {{ e.targetType || '—' }}
                      @if (e.targetId) {
                        <small class="a-mono">{{ e.targetId }}</small>
                      }
                    </td>
                    <td data-label="Details">
                      <button
                        type="button"
                        class="btn btn--ghost btn--sm"
                        [attr.aria-expanded]="open() === e.id"
                        [attr.aria-controls]="'audit-' + e.id"
                        (click)="toggle(e.id)"
                      >
                        <app-icon [name]="open() === e.id ? 'chevron-up' : 'chevron-down'" [size]="16" />
                        {{ open() === e.id ? 'Hide' : 'Show' }}
                      </button>
                      @if (open() === e.id) {
                        <pre class="a-meta" [id]="'audit-' + e.id">{{ details(e) }}</pre>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <app-pager [page]="page.page" [pageSize]="page.pageSize" [total]="page.total" (pageChange)="goTo($event)" />
        } @else {
          <app-state-panel title="No entries match" message="Widen the dates or clear the filters." />
        }
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3, 4, 5, 6]; track n) {
            <span class="skeleton"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading the audit log…</p>
      }
    }
  `,
  styles: `
    .action {
      font-weight: 700;
    }
    .a-meta {
      margin-top: 0.5rem;
      min-width: min(22rem, 70vw);
    }
    td .btn--sm {
      min-height: 2.75rem;
    }
  `,
})
export class AdminAudit {
  private readonly api = inject(AdminApi);

  protected readonly action = signal('');
  protected readonly targetType = signal('');
  protected readonly actorId = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly open = signal<string | null>(null);
  private readonly page = signal(1);

  protected readonly logs = loader(() =>
    this.api.auditLogs({
      action: this.action().trim() || undefined,
      targetType: this.targetType().trim() || undefined,
      actorId: this.actorId().trim() || undefined,
      from: this.from() || undefined,
      to: this.to() || undefined,
      page: this.page(),
      pageSize: PAGE_SIZE,
    }),
  );

  constructor() {
    this.logs.load();
  }

  protected toggle(id: string): void {
    this.open.update((current) => (current === id ? null : id));
  }

  protected details(entry: AuditLogEntry): string {
    return JSON.stringify({ requestId: entry.requestId, actorId: entry.actorId, ...entry.metadata }, null, 2);
  }

  protected apply(): void {
    this.page.set(1);
    this.open.set(null);
    this.logs.load();
  }

  protected clear(): void {
    this.action.set('');
    this.targetType.set('');
    this.actorId.set('');
    this.from.set('');
    this.to.set('');
    this.apply();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.open.set(null);
    this.logs.load();
  }
}
