import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { FeatureFlag, VerificationStatus } from '@payana/contracts';
import { AuthStore } from '@core/auth/auth.store';
import { AppConfigService } from '@core/config/app-config.service';
import { ConsoleShell, type ConsoleNavItem } from '@layout/console-shell';
import { LocationSharing } from './location-sharing';
import { currentDocument, documentSlot, isStepDone, onboardingSteps } from './partner-logic';
import { PartnerStore } from './partner.store';

/**
 * Frame of the partner area. It owns the shared store and the location
 * sharing service, so both end when the partner leaves the area or signs out.
 */
@Component({
  selector: 'app-partner-layout',
  imports: [ConsoleShell],
  providers: [PartnerStore, LocationSharing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-console-shell area="Partner" tone="partner" [nav]="nav()" />`,
})
export class PartnerLayout {
  private readonly store = inject(PartnerStore);
  private readonly config = inject(AppConfigService);

  constructor() {
    // Created here so that sharing follows availability on every partner screen.
    inject(LocationSharing);
  }

  /** Steps of onboarding still to do; 0 once the profile is with the verification team. */
  private readonly setupRemaining = computed(() => {
    if (!this.store.profileKnown()) return 0;
    const profile = this.store.profile.data();
    return onboardingSteps(profile?.partnerType ?? null).filter((step) => !isStepDone(profile, step)).length;
  });

  /** Documents that are rejected, expired or about to expire. */
  private readonly documentsNeedingAttention = computed(() => {
    const documents = this.store.documents.data() ?? [];
    const today = new Date();
    return documents.filter((d) => {
      // Only the document currently filling each slot counts.
      if (currentDocument(documents, d.type, d.vehicleId ?? null)?.id !== d.id) return false;
      const { state } = documentSlot(d, today);
      return state === 'rejected' || state === 'expired' || state === 'expiring';
    }).length;
  });

  protected readonly nav = computed<ConsoleNavItem[]>(() => {
    const status = this.store.profile.data()?.verificationStatus;
    const inSetup =
      this.store.profileKnown() &&
      (!this.store.hasProfile() ||
        status === VerificationStatus.Incomplete ||
        status === VerificationStatus.ChangesRequested ||
        status === VerificationStatus.Rejected);

    const items: ConsoleNavItem[] = [{ label: 'Dashboard', icon: 'home', link: '/partner', exact: true }];
    if (inSetup) {
      items.push({ label: 'Get verified', icon: 'shield-check', link: '/partner/onboarding', badge: this.setupRemaining() });
    }
    items.push(
      { label: 'Requests', icon: 'inbox', link: '/partner/requests', group: 'Work' },
      { label: 'Bookings', icon: 'ticket', link: '/partner/bookings' },
      { label: 'Vehicles', icon: 'car', link: '/partner/vehicles', group: 'My listing' },
      { label: 'Documents', icon: 'document', link: '/partner/documents', badge: this.documentsNeedingAttention() },
      { label: 'Team', icon: 'users', link: '/partner/team' },
    );

    const plans = this.config.isEnabled(FeatureFlag.Subscriptions) || this.config.isEnabled(FeatureFlag.FeaturedListings);
    const reviews = this.config.isEnabled(FeatureFlag.Reviews);
    if (plans) items.push({ label: 'Plan & billing', icon: 'card', link: '/partner/plan', group: 'Account' });
    if (reviews) items.push({ label: 'Reviews', icon: 'star', link: '/partner/reviews', group: plans ? undefined : 'Account' });
    return items;
  });
}

/**
 * Screens that only make sense once a partner profile exists send a newcomer
 * to onboarding instead. A convenience only - the API refuses the same calls.
 */
export const hasProfileGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const toOnboarding = router.createUrlTree(['/partner/onboarding']);

  if (auth.me()?.driver?.profileId) return true;
  // The account record may simply be stale (profile created a moment ago).
  const fresh = auth.token() ? auth.reloadMe() : of(auth.me());
  return fresh.pipe(map((me) => (me?.driver?.profileId ? true : toOnboarding)));
};
