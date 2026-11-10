import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthorizationStatus, type VehicleAuthorization } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { DateOnlyPipe } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { formatRegistration, toIndianE164, toIsoDate } from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { fieldErrors } from '../shared/form-errors';
import { PartnerHead } from '../shared/page-head';

/**
 * Owner ↔ driver authorisations. Someone other than the registered owner may
 * operate a vehicle on the marketplace only with the owner's authorisation.
 */
@Component({
  selector: 'app-partner-team',
  imports: [ReactiveFormsModule, RouterLink, Icon, StatePanel, StatusBadge, DateOnlyPipe, PartnerHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './team.html',
  styleUrl: './team.scss',
})
export class Team {
  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PartnerStore);

  protected readonly today = toIsoDate(new Date());
  protected readonly busyId = signal<string | null>(null);
  protected readonly inviting = signal(false);
  protected readonly problem = signal('');

  protected readonly form = new FormGroup({
    vehicleId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    driverPhone: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    validUntil: new FormControl('', { nonNullable: true }),
  });
  protected readonly errors = fieldErrors(this.form, {
    vehicleId: { required: 'Choose the vehicle.' },
    driverPhone: { required: 'Enter the driver’s mobile number.' },
  });

  protected readonly vehicles = computed(() =>
    (this.store.vehicles.data() ?? []).map((v) => ({ id: v.id, label: `${v.make} ${v.model} · ${formatRegistration(v.registrationNumber)}` })),
  );
  private readonly me = computed(() => this.store.profile.data()?.id);
  private readonly all = computed(() => this.store.authorizations.data() ?? []);
  /** Authorisations I gave, as an owner. */
  protected readonly given = computed(() => this.all().filter((a) => a.ownerProfileId === this.me()));
  /** Authorisations other owners gave me. */
  protected readonly received = computed(() => this.all().filter((a) => a.ownerProfileId !== this.me()));

  protected isOpen(a: VehicleAuthorization): boolean {
    return a.status === AuthorizationStatus.Invited || a.status === AuthorizationStatus.Active;
  }

  protected invite(): void {
    if (this.inviting()) return;
    this.problem.set('');
    const valid = this.errors.validate();
    const value = this.form.getRawValue();
    const phone = toIndianE164(value.driverPhone);
    if (value.driverPhone && !phone) this.errors.set('driverPhone', 'Enter a 10-digit Indian mobile number.');
    if (value.validUntil && value.validUntil < this.today) this.errors.set('validUntil', 'Choose a date in the future.');
    if (!valid || !phone || this.errors.hasMessages()) return;

    this.inviting.set(true);
    this.api
      .createAuthorization({ vehicleId: value.vehicleId, driverPhone: phone, ...(value.validUntil ? { validUntil: value.validUntil } : {}) })
      .subscribe({
        next: () => {
          this.inviting.set(false);
          this.form.reset({ vehicleId: value.vehicleId, driverPhone: '', validUntil: '' });
          this.store.authorizations.load({ silent: true });
          this.toasts.success('Invitation sent. It appears in the driver’s Team page.');
        },
        error: (error: unknown) => {
          this.inviting.set(false);
          const apiError = toApiError(error);
          const unplaced = this.errors.accept(apiError);
          this.problem.set(unplaced[0] ?? (apiError.fieldErrors.length ? '' : (apiError.problem?.detail ?? apiError.message)));
        },
      });
  }

  protected accept(a: VehicleAuthorization): void {
    this.act(a.id, this.api.acceptAuthorization(a.id), `You can now drive ${a.vehicleLabel}.`);
  }

  protected revoke(a: VehicleAuthorization): void {
    this.act(a.id, this.api.revokeAuthorization(a.id), 'Authorisation ended.');
  }

  private act(id: string, call: ReturnType<PartnerApi['acceptAuthorization']>, done: string): void {
    if (this.busyId()) return;
    this.busyId.set(id);
    call.subscribe({
      next: () => {
        this.busyId.set(null);
        this.store.authorizations.load({ silent: true });
        this.toasts.success(done);
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        const apiError = toApiError(error);
        this.toasts.error(apiError.problem?.detail ?? apiError.message);
      },
    });
  }
}
