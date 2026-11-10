import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FeatureFlag, type SubscriptionPlan } from '@payana/contracts';
import { CatalogApi } from '@core/api/public.api';
import { AuthStore } from '@core/auth/auth.store';
import { BRAND } from '@core/brand';
import { AppConfigService } from '@core/config/app-config.service';
import { MoneyPipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { Icon, type IconName } from '@ui/icon';
import { Reveal, ScrollProgress } from '@ui/motion';
import { StatePanel } from '@ui/primitives';
import { VehicleArt } from '@ui/vehicle-art';
import { Photo } from '@ui/photo';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'phone', title: 'Sign up with your phone', text: 'Your mobile number and a one-time code. No password, no paperwork to start.' },
  { icon: 'car', title: 'Add your vehicle', text: 'Type, registration number, seats and a few photos. Set the rates you want to be found at.' },
  { icon: 'document', title: 'Upload your papers', text: 'Photos of your documents, straight from your phone. Our team checks each one and tells you the result.' },
  { icon: 'power', title: 'Go online and quote', text: 'Ride requests near you arrive on your phone. Send your price; if the customer picks you, the booking is yours.' },
];

const DOCUMENTS = [
  'Identity proof (Aadhaar, voter ID or passport)',
  'Driving licence valid for the vehicle class',
  'Registration certificate (RC)',
  'Insurance policy, in date',
  'Permit for carrying passengers',
  'Fitness certificate',
  'Pollution (PUC) certificate',
];

const PERIOD: Record<string, string> = { monthly: 'month', quarterly: 'quarter', yearly: 'year' };

/** "Drive with us": what the platform offers drivers and owners, what it takes to join, and the plans. */
@Component({
  selector: 'app-drive',
  imports: [RouterLink, Icon, VehicleArt, Photo, StatePanel, Reveal, ScrollProgress, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drive.html',
  styleUrl: './drive.scss',
})
export class Drive {
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly config = inject(AppConfigService);

  protected readonly brand = BRAND;
  protected readonly steps = STEPS;
  protected readonly documents = DOCUMENTS;

  protected readonly signUpOpen = computed(() => this.config.isEnabled(FeatureFlag.DriverSignUp));
  protected readonly plansOn = computed(() => this.config.isEnabled(FeatureFlag.Subscriptions));
  protected readonly plans = loader(() => this.catalog.plans());

  /** Someone already driving goes to their dashboard; everyone else to sign-up. */
  protected readonly isDriver = this.auth.isDriver;

  constructor() {
    if (this.plansOn()) this.plans.load();
  }

  protected period(plan: SubscriptionPlan): string {
    return PERIOD[plan.billingPeriod] ?? plan.billingPeriod;
  }

  protected entitlements(plan: SubscriptionPlan): string[] {
    const e = plan.entitlements;
    return [
      e.maxVehicles === 1 ? '1 vehicle listed' : `Up to ${e.maxVehicles} vehicles listed`,
      e.monthlyQuoteLimit === null ? 'Unlimited quotes' : `${e.monthlyQuoteLimit} quotes a month`,
      ...(e.priorityInSearch ? ['Shown ahead of free listings'] : []),
      ...(e.featuredDaysIncluded ? [`${e.featuredDaysIncluded} featured days each ${this.period(plan)}`] : []),
      ...(e.badge ? [`“${e.badge}” badge on your listing`] : []),
      ...(e.analytics ? ['Performance dashboard'] : []),
    ];
  }
}
