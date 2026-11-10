import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ADMIN_PASSWORD_MIN_LENGTH, AdminRole, type StaffMember } from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { AuthStore } from '@core/auth/auth.store';
import { HumanizePipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Modal, StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { applyServerErrors, controlError, touchAll } from '../shared/forms';
import { generateTemporaryPassword } from '../shared/rules';

type Pending =
  | { kind: 'role'; member: StaffMember; role: AdminRole }
  | { kind: 'status'; member: StaffMember; status: 'active' | 'suspended' };

/** Staff accounts and their roles. Only the privileged role can open this screen. */
@Component({
  selector: 'app-admin-staff',
  imports: [ReactiveFormsModule, Icon, StatePanel, StatusBadge, Modal, ConfirmDialog, HumanizePipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="a-head">
      <div>
        <h1>Staff</h1>
        <p>Who can use this console, and as what. Give each person the narrowest role that lets them do their job.</p>
      </div>
      <div class="a-head__actions">
        <button type="button" class="btn btn--dark" (click)="openCreate()"><app-icon name="plus" [size]="16" /> Add staff member</button>
      </div>
    </header>

    <p class="notice mfa">
      <app-icon name="lock" [size]="18" />
      <span>
        <strong>Two-step sign-in.</strong> Super admins must always sign in with an authenticator code and are asked to set one up
        on first sign-in. Other roles can use one too; the column below shows who has.
      </span>
    </p>

    @switch (staff.status()) {
      @case ('error') {
        <app-state-panel [error]="staff.error()" (retry)="staff.load()" />
      }
      @case ('ready') {
        @if (staff.data()!.length) {
          <div class="table-wrap table-wrap--stack">
            <table class="table">
              <caption class="visually-hidden">Staff accounts</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Two-step sign-in</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (m of staff.data(); track m.id) {
                  <tr>
                    <td data-label="Name">
                      <strong>{{ m.displayName }}</strong>
                      <small>{{ m.email }}{{ m.id === me()?.id ? ' · this is you' : '' }}</small>
                    </td>
                    <td data-label="Role">
                      @if (m.id === me()?.id) {
                        {{ m.adminRole | humanize }}
                      } @else {
                        <label class="visually-hidden" [for]="'role-' + m.id">Role of {{ m.displayName }}</label>
                        <select class="select role" [id]="'role-' + m.id" (change)="askRole(m, $any($event.target))">
                          @for (r of roles; track r) {
                            <option [value]="r" [selected]="m.adminRole === r">{{ r | humanize }}</option>
                          }
                        </select>
                      }
                    </td>
                    <td data-label="Status"><app-status-badge kind="user" [value]="m.status" /></td>
                    <td data-label="Two-step">
                      @if (m.mfaEnabled) {
                        <span class="a-ok"><app-icon name="check" [size]="15" /> On</span>
                      } @else {
                        <span [class.a-danger]="m.adminRole === 'super_admin'">{{ m.adminRole === 'super_admin' ? 'Not set up yet' : 'Off' }}</span>
                      }
                    </td>
                    <td data-label="Last sign-in">{{ m.lastLoginAt ? (m.lastLoginAt | relativeTime) : 'Never' }}</td>
                    <td data-label="">
                      <div class="a-row-actions">
                        @if (m.id !== me()?.id) {
                          @if (m.status === 'active') {
                            <button type="button" class="btn btn--outline btn--sm" (click)="pending.set({ kind: 'status', member: m, status: 'suspended' })">Suspend</button>
                          } @else if (m.status === 'suspended') {
                            <button type="button" class="btn btn--soft btn--sm" (click)="pending.set({ kind: 'status', member: m, status: 'active' })">Reactivate</button>
                          }
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <app-state-panel title="No staff yet" message="Add the first staff member." />
        }
      }
      @default {
        <div class="a-skeleton-rows" aria-hidden="true">
          @for (n of [1, 2, 3, 4]; track n) {
            <span class="skeleton"></span>
          }
        </div>
        <p class="visually-hidden" role="status">Loading staff…</p>
      }
    }

    <app-modal [open]="creating()" title="Add staff member" (closed)="creating.set(false)">
      <form id="staff-form" class="create" [formGroup]="form" (submit)="$event.preventDefault(); create()" novalidate>
        <div class="field">
          <label class="field__label" for="sf-name">Full name</label>
          <input id="sf-name" class="input" formControlName="displayName" autocomplete="off" maxlength="80" [attr.aria-invalid]="err(form.controls.displayName) ? 'true' : null" />
          @if (err(form.controls.displayName, 'Name'); as e) {
            <p class="field__error">{{ e }}</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="sf-email">Work e-mail</label>
          <input id="sf-email" class="input" type="email" formControlName="email" autocomplete="off" [attr.aria-invalid]="err(form.controls.email) ? 'true' : null" />
          @if (err(form.controls.email, 'E-mail'); as e) {
            <p class="field__error">{{ e }}</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="sf-role">Role</label>
          <select id="sf-role" class="select" formControlName="adminRole">
            @for (r of roles; track r) {
              <option [value]="r">{{ r | humanize }}</option>
            }
          </select>
          @if (form.controls.adminRole.value === 'super_admin') {
            <p class="field__hint a-warn">Super admins can change settings, staff and every record. Keep this role to very few people.</p>
          }
        </div>
        <div class="field">
          <label class="field__label" for="sf-pass">Temporary password</label>
          <div class="pass">
            <input id="sf-pass" class="input a-mono" type="text" formControlName="temporaryPassword" autocomplete="off" spellcheck="false" [attr.aria-invalid]="err(form.controls.temporaryPassword) ? 'true' : null" />
            <button type="button" class="btn btn--outline btn--sm" (click)="generate()">Generate</button>
          </div>
          @if (err(form.controls.temporaryPassword, 'The password'); as e) {
            <p class="field__error">{{ e }}</p>
          } @else {
            <p class="field__hint">At least {{ minLength }} characters. Pass it on privately; they must change it on first sign-in.</p>
          }
        </div>
        @if (problem()) {
          <p class="notice notice--danger" role="alert">{{ problem() }}</p>
        }
      </form>
      <ng-container modalActions>
        <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="creating.set(false)">Cancel</button>
        <button type="submit" form="staff-form" class="btn btn--dark" [class.is-loading]="busy()" [disabled]="busy()">Add staff member</button>
      </ng-container>
    </app-modal>

    <app-admin-confirm
      [open]="!!pending()"
      [title]="confirmTitle()"
      [confirmLabel]="confirmTitle()"
      [tone]="pending()?.kind === 'status' && $any(pending()).status === 'suspended' ? 'danger' : 'dark'"
      [busy]="busy()"
      (confirmed)="applyPending()"
      (cancelled)="cancelPending()"
    >
      @if (pending(); as p) {
        @if (p.kind === 'role') {
          Change <strong>{{ p.member.displayName }}</strong> from {{ p.member.adminRole | humanize }} to
          <strong>{{ p.role | humanize }}</strong>? What they can see and do changes at their next request.
        } @else if (p.status === 'suspended') {
          Suspend <strong>{{ p.member.displayName }}</strong>? They are signed out and cannot use the console until reactivated.
        } @else {
          Reactivate <strong>{{ p.member.displayName }}</strong>? They can sign in again straight away.
        }
      }
    </app-admin-confirm>
  `,
  styles: `
    .mfa {
      margin-bottom: 1.1rem;
    }
    .role {
      min-width: 11.5rem;
    }
    .a-ok {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .create {
      display: grid;
      gap: 1rem;
    }
    .pass {
      display: flex;
      gap: 0.5rem;
    }
    .pass .btn {
      min-height: 2.9rem;
    }
  `,
})
export class AdminStaff {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly roles = Object.values(AdminRole);
  protected readonly minLength = ADMIN_PASSWORD_MIN_LENGTH;
  protected readonly me = this.auth.me;
  protected readonly err = controlError;

  protected readonly staff = loader(() => this.api.staff());
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected readonly problem = signal('');
  protected readonly pending = signal<Pending | null>(null);
  /** The <select> a role change came from, so a cancel can put it back. */
  private roleSelect: HTMLSelectElement | null = null;

  protected readonly form = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(80)]],
    email: ['', [Validators.required, Validators.email]],
    adminRole: [AdminRole.SupportAgent as AdminRole],
    temporaryPassword: ['', [Validators.required, Validators.minLength(ADMIN_PASSWORD_MIN_LENGTH)]],
  });

  constructor() {
    this.staff.load();
  }

  protected confirmTitle(): string {
    const p = this.pending();
    if (!p) return 'Confirm';
    if (p.kind === 'role') return 'Change role';
    return p.status === 'suspended' ? 'Suspend staff member' : 'Reactivate staff member';
  }

  protected openCreate(): void {
    this.form.reset({ displayName: '', email: '', adminRole: AdminRole.SupportAgent, temporaryPassword: generateTemporaryPassword() });
    this.problem.set('');
    this.creating.set(true);
  }

  protected generate(): void {
    this.form.controls.temporaryPassword.setValue(generateTemporaryPassword());
  }

  protected create(): void {
    touchAll(this.form);
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.problem.set('');
    this.api.createStaff(this.form.getRawValue()).subscribe({
      next: (member) => {
        this.staff.update((list) => [...list, member]);
        this.busy.set(false);
        this.creating.set(false);
        this.toasts.success(`${member.displayName} added. Share the temporary password privately.`);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(applyServerErrors(this.form, error));
      },
    });
  }

  protected askRole(member: StaffMember, select: HTMLSelectElement): void {
    this.roleSelect = select;
    this.pending.set({ kind: 'role', member, role: select.value as AdminRole });
  }

  protected cancelPending(): void {
    const p = this.pending();
    if (p?.kind === 'role' && this.roleSelect) this.roleSelect.value = p.member.adminRole;
    this.roleSelect = null;
    this.pending.set(null);
  }

  protected applyPending(): void {
    const p = this.pending();
    if (!p) return;
    this.busy.set(true);
    const change = p.kind === 'role' ? { adminRole: p.role } : { status: p.status };
    this.api.updateStaff(p.member.id, change).subscribe({
      next: (updated) => {
        this.staff.update((list) => list.map((m) => (m.id === updated.id ? updated : m)));
        this.busy.set(false);
        this.roleSelect = null;
        this.pending.set(null);
        this.toasts.success(`${updated.displayName} updated.`);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }
}
