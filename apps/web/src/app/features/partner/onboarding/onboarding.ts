import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DocumentType, PartnerType, REQUIRED_VEHICLE_DOCUMENT_TYPES, VerificationStatus } from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { toApiError } from '@core/api/api-error';
import { PartnerApi } from '@core/api/partner.api';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { StatePanel } from '@ui/primitives';
import { DocumentSlotCard } from '../documents/document-slot';
import {
  currentDocument,
  formatRegistration,
  isStepDone,
  onboardingSteps,
  requiredPersonDocuments,
  resolveOnboardingStep,
  type OnboardingStepId,
} from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { ProfileForm } from '../profile/profile-form';
import { PartnerHead } from '../shared/page-head';
import { VehicleForm } from '../vehicles/vehicle-form';

const STEP_LABEL: Record<OnboardingStepId, string> = {
  profile: 'About you',
  vehicle: 'Your vehicle',
  'person-documents': 'Your documents',
  'vehicle-documents': 'Vehicle documents',
  review: 'Review and submit',
};

/**
 * Guided set-up: profile → vehicle → documents → submit for review. Progress
 * comes from the server's checklist, so it can be left and resumed on any
 * device, and it always opens at the first step still to do.
 */
@Component({
  selector: 'app-partner-onboarding',
  imports: [RouterLink, Icon, StatePanel, PartnerHead, ProfileForm, VehicleForm, DocumentSlotCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
})
export class Onboarding {
  private readonly api = inject(PartnerApi);
  private readonly toasts = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  protected readonly store = inject(PartnerStore);

  protected readonly vehicleDocTypes = REQUIRED_VEHICLE_DOCUMENT_TYPES;
  protected readonly puc = DocumentType.PollutionCertificate;
  protected readonly ownerLetter = DocumentType.OwnerAuthorisation;

  protected readonly step = signal<OnboardingStepId>('profile');
  protected readonly addingVehicle = signal(false);
  protected readonly busy = signal(false);
  protected readonly problem = signal('');
  private positioned = false;

  protected readonly profile = computed(() => this.store.profile.data());
  protected readonly vehicles = computed(() => this.store.vehicles.data() ?? []);
  protected readonly documents = computed(() => this.store.documents.data() ?? []);
  protected readonly isHired = computed(() => this.profile()?.partnerType === PartnerType.HiredDriver);

  protected readonly steps = computed(() =>
    onboardingSteps(this.profile()?.partnerType ?? null).map((id, index) => ({
      id,
      index: index + 1,
      label: STEP_LABEL[id],
      done: isStepDone(this.profile(), id),
    })),
  );

  protected readonly personDocTypes = computed(() => {
    const type = this.profile()?.partnerType;
    return type ? requiredPersonDocuments(type) : [];
  });

  protected readonly status = computed(() => this.profile()?.verificationStatus ?? VerificationStatus.Incomplete);
  protected readonly canSubmit = computed(() => {
    const s = this.status();
    return (
      !!this.profile()?.onboarding.readyForReview &&
      (s === VerificationStatus.Incomplete || s === VerificationStatus.ChangesRequested || s === VerificationStatus.Rejected)
    );
  });

  constructor() {
    // Open at the first unfinished step, once, when the profile is known.
    effect(() => {
      if (!this.store.profileKnown() || this.positioned) return;
      this.positioned = true;
      const profile = this.profile();
      untracked(() => this.step.set(resolveOnboardingStep(profile)));
    });
  }

  protected go(id: OnboardingStepId): void {
    // Later steps need a profile to attach to.
    if (id !== 'profile' && !this.store.hasProfile()) return;
    this.step.set(id);
    this.problem.set('');
    this.addingVehicle.set(false);
    window.scrollTo({ top: 0 });
  }

  protected next(): void {
    const ids = this.steps().map((s) => s.id);
    const done = this.step();
    this.analytics.track('driver_onboarding_step', { step: done });
    this.go(ids[Math.min(ids.indexOf(done) + 1, ids.length - 1)]!);
  }

  protected doc(type: DocumentType, vehicleId: string | null) {
    return currentDocument(this.documents(), type, vehicleId);
  }

  protected plate(registration: string): string {
    return formatRegistration(registration);
  }

  protected onVehicleSaved(): void {
    this.addingVehicle.set(false);
  }

  protected submit(): void {
    if (this.busy() || !this.canSubmit()) return;
    this.busy.set(true);
    this.problem.set('');
    this.api.submitForReview().subscribe({
      next: (profile) => {
        this.busy.set(false);
        this.store.setProfile(profile);
        this.analytics.track('driver_onboarding_step', { step: 'submitted' });
        this.toasts.success('Sent for review. We will notify you when it is decided.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const apiError = toApiError(error);
        this.problem.set(apiError.problem?.detail ?? apiError.message);
        this.store.refreshProfile();
      },
    });
  }
}
