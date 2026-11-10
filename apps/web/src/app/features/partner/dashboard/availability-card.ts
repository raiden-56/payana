import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvailabilityStatus, ErrorCode } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { RelativeTimePipe } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { LocationSharing, PING_INTERVAL_MS } from '../location-sharing';
import { PartnerStore } from '../partner.store';

interface Problem {
  text: string;
  link?: { label: string; to: string };
}

const CHOICES: { value: AvailabilityStatus; label: string; help: string }[] = [
  { value: AvailabilityStatus.Available, label: 'Available', help: 'You appear in searches and receive requests.' },
  { value: AvailabilityStatus.Busy, label: 'Busy', help: 'Listed, but shown as on a trip.' },
  { value: AvailabilityStatus.Offline, label: 'Offline', help: 'Hidden from “available now” searches.' },
];

/** Go online / offline, choose the vehicle on the road, and control location sharing. */
@Component({
  selector: 'app-availability-card',
  imports: [RouterLink, Icon, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './availability-card.html',
  styleUrl: './availability-card.scss',
})
export class AvailabilityCard {
  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PartnerStore);
  protected readonly sharing = inject(LocationSharing);

  protected readonly choices = CHOICES;
  protected readonly pingSeconds = PING_INTERVAL_MS / 1000;

  protected readonly busy = signal(false);
  protected readonly problem = signal<Problem | null>(null);
  /** The vehicle picked in the select; defaults to the one last used. */
  protected readonly vehicleId = signal<string>('');

  protected readonly profile = computed(() => this.store.profile.data());
  protected readonly status = computed(() => this.profile()?.availability ?? AvailabilityStatus.Offline);
  protected readonly vehicles = this.store.operableVehicles;
  protected readonly current = computed(() => CHOICES.find((c) => c.value === this.status())!);

  protected readonly sharingText = computed(() => {
    switch (this.sharing.state()) {
      case 'sharing':
        return 'Sharing your position';
      case 'waiting':
        return 'Waiting for a position from your phone…';
      case 'paused':
        return 'Paused — you are offline';
      case 'blocked':
        return 'Not sharing';
      default:
        return this.sharing.enabled() ? 'Starts when you are available' : 'Switched off';
    }
  });

  constructor() {
    // Follow the server's idea of the active vehicle until the driver picks another.
    effect(() => {
      const active = this.profile()?.activeVehicleId;
      const options = this.vehicles();
      if (this.vehicleId() && options.some((v) => v.id === this.vehicleId())) return;
      const fallback = options.find((v) => v.id === active) ?? options[0];
      if (fallback) this.vehicleId.set(fallback.id);
    });
  }

  protected choose(status: AvailabilityStatus): void {
    if (this.busy() || status === this.status()) return;
    const goingOnline = status !== AvailabilityStatus.Offline;
    if (goingOnline && !this.vehicleId()) {
      this.problem.set({
        text: 'Choose the vehicle you are driving first.',
        link: this.vehicles().length ? undefined : { label: 'Add a vehicle', to: '/partner/vehicles' },
      });
      return;
    }

    this.busy.set(true);
    this.problem.set(null);
    this.api.setAvailability({ status, vehicleId: goingOnline ? this.vehicleId() : undefined }).subscribe({
      next: (profile) => {
        this.busy.set(false);
        this.store.setProfile(profile);
        this.toasts.success(
          status === AvailabilityStatus.Available
            ? 'You are available. Requests will reach you now.'
            : status === AvailabilityStatus.Busy
              ? 'Marked as busy.'
              : 'You are offline.',
        );
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(this.explain(toApiError(error)));
      },
    });
  }

  /** Changing vehicle while online has to be told to the server straight away. */
  protected onVehicleChange(event: Event): void {
    this.vehicleId.set((event.target as HTMLSelectElement).value);
    const status = this.status();
    if (status === AvailabilityStatus.Offline || this.busy()) return;
    this.busy.set(true);
    this.problem.set(null);
    this.api.setAvailability({ status, vehicleId: this.vehicleId() }).subscribe({
      next: (profile) => {
        this.busy.set(false);
        this.store.setProfile(profile);
        this.toasts.success('Vehicle updated.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(this.explain(toApiError(error)));
        // The server kept the previous vehicle; show that again.
        this.vehicleId.set(this.profile()?.activeVehicleId ?? '');
      },
    });
  }

  protected onSharingToggle(event: Event): void {
    this.sharing.setEnabled((event.target as HTMLInputElement).checked);
  }

  private explain(error: ReturnType<typeof toApiError>): Problem {
    const detail = error.problem?.detail;
    switch (error.code) {
      case ErrorCode.DriverNotVerified:
        return {
          text: detail ?? 'Your profile and this vehicle have to be approved before you can go online.',
          link: { label: 'Check verification', to: '/partner/onboarding' },
        };
      case ErrorCode.VehicleNotAuthorized:
        return {
          text: 'You are not authorised to operate this vehicle. Its owner has to authorise you first.',
          link: { label: 'Open Team', to: '/partner/team' },
        };
      case ErrorCode.DocumentExpired:
        return {
          text: 'A required document is missing or has expired, so this vehicle cannot go online yet.',
          link: { label: 'Open Documents', to: '/partner/documents' },
        };
      case ErrorCode.ValidationFailed:
        return { text: error.fieldErrors[0]?.message ?? 'Choose the vehicle you are driving.' };
      default:
        return { text: error.message };
    }
  }
}
