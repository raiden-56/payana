import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AccountRole, Permission, UserStatus, type AdminUserRow } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { AuthStore } from '@core/auth/auth.store';
import { DateOnlyPipe, HumanizePipe, PhonePipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { Pager, StatusBadge } from '@ui/status';
import { ConfirmDialog } from '../shared/confirm-dialog';

const PAGE_SIZE = 20;

/** Accounts: find a person, see their roles and status, suspend or reinstate. */
@Component({
  selector: 'app-admin-users',
  imports: [Icon, StatePanel, StatusBadge, Pager, ConfirmDialog, DateOnlyPipe, RelativeTimePipe, PhonePipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="a-head">
      <div>
        <h1>Users</h1>
        <p>Every customer, driver and staff account. Suspending signs the person out everywhere and blocks new sign-ins.</p>
      </div>
    </header>

    <form class="a-filters" role="search" (submit)="$event.preventDefault(); apply()">
      <div class="field a-filters__wide">
        <label class="field__label" for="users-q">Search</label>
        <input id="users-q" class="input" type="search" placeholder="Phone, e-mail or name" [value]="q()" (input)="q.set($any($event.target).value)" />
      </div>
      <div class="field">
        <label class="field__label" for="users-role">Role</label>
        <select id="users-role" class="select" [value]="role()" (change)="role.set($any($event.target).value); apply()">
          <option value="">Any role</option>
          @for (r of roles; track r) {
            <option [value]="r">{{ r | humanize }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="users-status">Status</label>
        <select id="users-status" class="select" [value]="status()" (change)="status.set($any($event.target).value); apply()">
          <option value="">Any status</option>
          @for (s of statuses; track s) {
            <option [value]="s">{{ s | humanize }}</option>
          }
        </select>
      </div>
      <div class="a-filters__actions">
        <button type="submit" class="btn btn--dark"><app-icon name="search" [size]="16" /> Search</button>
      </div>
    </form>

    @switch (users.status()) {
      @case ('error') {
        <app-state-panel [error]="users.error()" (retry)="users.load()" />
      }
      @case ('ready') {
        @let page = users.data()!;
        @if (page.items.length) {
          <div class="table-wrap table-wrap--stack">
            <table class="table">
              <caption class="visually-hidden">User accounts</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Phone</th>
                  <th scope="col">E-mail</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last seen</th>
                  @if (canSuspend) {
                    <th scope="col"><span class="visually-hidden">Actions</span></th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (user of page.items; track user.id) {
                  <tr>
                    <td data-label="Name">
                      <strong>{{ user.displayName || 'No name yet' }}</strong>
                      @if (user.id === me()?.id) {
                        <small>This is you</small>
                      }
                    </td>
                    <td data-label="Phone" class="tabular">{{ (user.phone | phone) || '—' }}</td>
                    <td data-label="E-mail">{{ user.email || '—' }}</td>
                    <td data-label="Roles">
                      <span class="a-tags">
                        @for (r of user.roles; track r) {
                          <span class="badge" [class.badge--dark]="r === 'admin'" [class.badge--accent]="r === 'driver'">{{ r | humanize }}</span>
                        }
                      </span>
                    </td>
                    <td data-label="Status"><app-status-badge kind="user" [value]="user.status" /></td>
                    <td data-label="Joined"><time [attr.datetime]="user.createdAt">{{ user.createdAt | dateOnly }}</time></td>
                    <td data-label="Last seen">{{ user.lastSeenAt ? (user.lastSeenAt | relativeTime) : 'Never' }}</td>
                    @if (canSuspend) {
                      <td data-label="">
                        <div class="a-row-actions">
                          @if (user.id !== me()?.id) {
                            @if (user.status === 'active') {
                              <button type="button" class="btn btn--outline btn--sm" (click)="toSuspend.set(user)">Suspend</button>
                            } @else if (user.status === 'suspended') {
                              <button type="button" class="btn btn--soft btn--sm" (click)="toReinstate.set(user)">Reinstate</button>
                            }
                          }
                        </div>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <app-pager [page]="page.page" [pageSize]="page.pageSize" [total]="page.total" (pageChange)="goTo($event)" />
        } @else {
          <app-state-panel title="No accounts match" message="Try a different phone number, name or filter." />
        }
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3, 4, 5, 6]; track n) {
            <span class="skeleton"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading accounts…</p>
      }
    }

    <app-admin-confirm
      [open]="!!toSuspend()"
      title="Suspend account"
      confirmLabel="Suspend account"
      tone="danger"
      reasonLabel="Reason for suspending"
      [reasonRequired]="true"
      [busy]="busy()"
      (confirmed)="suspend($event)"
      (cancelled)="toSuspend.set(null)"
    >
      Suspend <strong>{{ label(toSuspend()) }}</strong>? They will be signed out on every device and cannot sign in again until
      the account is reinstated. Existing bookings are not cancelled automatically.
    </app-admin-confirm>

    <app-admin-confirm
      [open]="!!toReinstate()"
      title="Reinstate account"
      confirmLabel="Reinstate"
      [busy]="busy()"
      (confirmed)="reinstate()"
      (cancelled)="toReinstate.set(null)"
    >
      Reinstate <strong>{{ label(toReinstate()) }}</strong>? They will be able to sign in again straight away.
    </app-admin-confirm>
  `,
})
export class AdminUsers {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);

  protected readonly roles = Object.values(AccountRole);
  protected readonly statuses = Object.values(UserStatus);
  protected readonly canSuspend = this.auth.hasPermission(Permission.UsersSuspend);
  protected readonly me = this.auth.me;

  protected readonly q = signal('');
  protected readonly role = signal<AccountRole | ''>('');
  protected readonly status = signal<UserStatus | ''>('');
  private readonly page = signal(1);

  protected readonly users = loader(() =>
    this.api.users({
      q: this.q().trim() || undefined,
      role: this.role() || undefined,
      status: this.status() || undefined,
      page: this.page(),
      pageSize: PAGE_SIZE,
    }),
  );

  protected readonly toSuspend = signal<AdminUserRow | null>(null);
  protected readonly toReinstate = signal<AdminUserRow | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    this.users.load();
  }

  protected apply(): void {
    this.page.set(1);
    this.users.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    this.users.load();
  }

  protected label(user: AdminUserRow | null): string {
    return user?.displayName || user?.phone || user?.email || 'this account';
  }

  protected suspend(reason: string): void {
    const user = this.toSuspend();
    if (!user) return;
    this.busy.set(true);
    this.api.suspendUser(user.id, { reason }).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.toasts.success(`${this.label(user)} is suspended.`);
        this.busy.set(false);
        this.toSuspend.set(null);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }

  protected reinstate(): void {
    const user = this.toReinstate();
    if (!user) return;
    this.busy.set(true);
    this.api.reinstateUser(user.id).subscribe({
      next: (updated) => {
        this.replace(updated);
        this.toasts.success(`${this.label(user)} is reinstated.`);
        this.busy.set(false);
        this.toReinstate.set(null);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }

  private replace(updated: AdminUserRow): void {
    this.users.update((page) => ({ ...page, items: page.items.map((u) => (u.id === updated.id ? updated : u)) }));
  }
}
