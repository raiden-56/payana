import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { REQUIRED_VEHICLE_DOCUMENT_TYPES, type Vehicle } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { MoneyPipe } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Reveal } from '@ui/motion';
import { Modal, StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { VehicleArt } from '@ui/vehicle-art';
import { currentDocument, documentSlot, formatRegistration } from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { PartnerHead } from '../shared/page-head';
import { RatesEditor } from './rates-editor';
import { VehicleForm } from './vehicle-form';

type Dialog = { kind: 'add' } | { kind: 'edit' | 'rates' | 'remove'; vehicle: Vehicle } | null;

/** The partner's vehicles: listing status, rates, and the forms to change them. */
@Component({
  selector: 'app-partner-vehicles',
  imports: [RouterLink, Icon, VehicleArt, StatusBadge, StatePanel, Modal, Reveal, MoneyPipe, PartnerHead, VehicleForm, RatesEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vehicles.html',
  styleUrl: './vehicles.scss',
})
export class Vehicles {
  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PartnerStore);

  protected readonly dialog = signal<Dialog>(null);
  protected readonly busy = signal(false);

  protected readonly editing = computed(() => {
    const d = this.dialog();
    return d && d.kind === 'edit' ? d.vehicle : null;
  });
  protected readonly rating = computed(() => {
    const d = this.dialog();
    return d && d.kind === 'rates' ? d.vehicle : null;
  });
  protected readonly removing = computed(() => {
    const d = this.dialog();
    return d && d.kind === 'remove' ? d.vehicle : null;
  });
  protected readonly formOpen = computed(() => this.dialog()?.kind === 'add' || this.dialog()?.kind === 'edit');

  protected plate(v: Vehicle): string {
    return formatRegistration(v.registrationNumber);
  }

  protected icon(v: Vehicle): string {
    return this.store.categoryFor(v)?.icon ?? 'sedan';
  }

  protected categoryName(v: Vehicle): string {
    return this.store.categoryFor(v)?.name ?? v.categoryCode;
  }

  /** How many of the four required documents are approved and current. */
  protected docsReady(v: Vehicle): number {
    const documents = this.store.documents.data() ?? [];
    const today = new Date();
    return REQUIRED_VEHICLE_DOCUMENT_TYPES.filter((type) => {
      const state = documentSlot(currentDocument(documents, type, v.id), today).state;
      return state === 'approved' || state === 'expiring';
    }).length;
  }

  protected readonly docsTotal = REQUIRED_VEHICLE_DOCUMENT_TYPES.length;

  protected close(): void {
    this.dialog.set(null);
  }

  protected remove(): void {
    const vehicle = this.removing();
    if (!vehicle || this.busy()) return;
    this.busy.set(true);
    this.api.removeVehicle(vehicle.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.close();
        this.store.refreshVehicles();
        this.store.refreshDocuments();
        this.toasts.info('Vehicle removed.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.close();
        const apiError = toApiError(error);
        this.toasts.error(apiError.problem?.detail ?? apiError.message);
      },
    });
  }
}
