import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DocumentType, PartnerType, REQUIRED_VEHICLE_DOCUMENT_TYPES } from '@payana/contracts';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { currentDocument, formatRegistration, requiredPersonDocuments } from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { PartnerHead } from '../shared/page-head';
import { DocumentSlotCard } from './document-slot';

/** Every document the partner holds, about themselves and about each vehicle, with its status. */
@Component({
  selector: 'app-partner-documents',
  imports: [RouterLink, Icon, StatePanel, PartnerHead, DocumentSlotCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-partner-head heading="Documents" lead="Our team checks each document. You are warned 30 days before one expires; an approved document stays in force until its replacement is approved." />

    @switch (store.documents.status()) {
      @case ('error') {
        <app-state-panel [error]="store.documents.error()" (retry)="store.documents.load()" />
      }
      @case ('ready') {
        <section class="group" aria-labelledby="docs-you">
          <h2 id="docs-you"><app-icon name="user" [size]="20" /> About you</h2>
          <div class="slots">
            @for (type of personTypes(); track type) {
              <app-document-slot [type]="type" [document]="doc(type, null)" (submitted)="store.refreshDocuments()" />
            }
            @if (isHired()) {
              <app-document-slot [type]="ownerLetter" [optional]="true" [document]="doc(ownerLetter, null)" (submitted)="store.refreshDocuments()" />
            }
          </div>
        </section>

        @for (v of vehicles(); track v.id) {
          <section class="group" [id]="'vehicle-' + v.id" [attr.aria-labelledby]="'docs-' + v.id">
            <h2 [id]="'docs-' + v.id"><app-icon name="car" [size]="20" /> {{ v.make }} {{ v.model }} <span class="tabular plate">{{ plate(v.registrationNumber) }}</span></h2>
            <div class="slots">
              @for (type of vehicleTypes; track type) {
                <app-document-slot [type]="type" [vehicleId]="v.id" [document]="doc(type, v.id)" (submitted)="store.refreshDocuments()" />
              }
              <app-document-slot [type]="puc" [vehicleId]="v.id" [optional]="true" [document]="doc(puc, v.id)" (submitted)="store.refreshDocuments()" />
            </div>
          </section>
        } @empty {
          @if (!isHired()) {
            <app-state-panel kind="info" title="No vehicle yet" message="Vehicle documents are attached to a vehicle. Add yours first.">
              <a routerLink="/partner/vehicles" class="btn btn--dark btn--sm">Add a vehicle</a>
            </app-state-panel>
          }
        }
      }
      @default {
        @for (n of [1, 2, 3]; track n) { <span class="skeleton" style="height: 7rem; margin-bottom: 0.75rem; border-radius: var(--r-md)" aria-hidden="true"></span> }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 56rem;
    }
    .group {
      display: grid;
      gap: 0.85rem;
      margin-bottom: var(--s-8);
      scroll-margin-top: 5rem;
    }
    h2 {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
    }
    .plate {
      font-size: 0.95rem;
      font-weight: 650;
      color: var(--color-text-muted);
    }
    .slots {
      display: grid;
      gap: 0.75rem;
    }
  `,
})
export class Documents {
  protected readonly store = inject(PartnerStore);

  protected readonly vehicleTypes = REQUIRED_VEHICLE_DOCUMENT_TYPES;
  protected readonly puc = DocumentType.PollutionCertificate;
  protected readonly ownerLetter = DocumentType.OwnerAuthorisation;

  protected readonly vehicles = computed(() => this.store.vehicles.data() ?? []);
  protected readonly isHired = computed(() => this.store.profile.data()?.partnerType === PartnerType.HiredDriver);
  protected readonly personTypes = computed(() => {
    const type = this.store.profile.data()?.partnerType;
    return type ? requiredPersonDocuments(type) : [];
  });

  protected doc(type: DocumentType, vehicleId: string | null) {
    return currentDocument(this.store.documents.data() ?? [], type, vehicleId);
  }

  protected plate(registration: string): string {
    return formatRegistration(registration);
  }
}
