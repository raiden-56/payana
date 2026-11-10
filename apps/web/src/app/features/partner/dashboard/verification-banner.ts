import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VerificationStatus, type DriverProfile } from '@payana/contracts';
import { Icon, type IconName } from '@ui/icon';
import { isStepDone, onboardingSteps } from '../partner-logic';

interface Banner {
  tone: 'accent' | 'warning' | 'success' | 'danger';
  icon: IconName;
  title: string;
  text: string;
  action?: { label: string; link: string };
}

/** Tells the partner where they stand with verification and what to do next. */
@Component({
  selector: 'app-verification-banner',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = banner();
    <section class="banner" [attr.data-tone]="b.tone" [attr.aria-label]="'Verification: ' + b.title">
      <span class="banner__icon"><app-icon [name]="b.icon" [size]="24" /></span>
      <div class="banner__text">
        <h2>{{ b.title }}</h2>
        <p>{{ b.text }}</p>
        @if (progress(); as p) {
          <div class="steps" role="img" [attr.aria-label]="p.done + ' of ' + p.total + ' steps done'">
            @for (done of p.steps; track $index) {
              <span [class.is-done]="done"></span>
            }
            <small>{{ p.done }} of {{ p.total }} steps done</small>
          </div>
        }
      </div>
      @if (b.action; as action) {
        <a class="btn btn--dark" [routerLink]="action.link">{{ action.label }} <app-icon class="btn__arrow" name="arrow-right" [size]="17" /></a>
      }
    </section>
  `,
  styles: `
    .banner {
      --tint: var(--marigold-100);
      --strong: var(--marigold-500);
      --on-strong: var(--ink-900);
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 0.9rem 1.1rem;
      padding: 1.1rem 1.2rem;
      border: var(--stroke) solid var(--ink-900);
      border-radius: var(--r-lg);
      background: var(--tint);
      box-shadow: var(--shadow-hard-sm);
      animation: rise-in var(--dur-3) var(--ease-out) both;
    }
    @media (min-width: 48rem) {
      .banner {
        grid-template-columns: auto 1fr auto;
      }
    }
    .banner[data-tone='success'] {
      --tint: var(--palm-50);
      --strong: var(--palm-600);
      --on-strong: var(--sand-0);
      box-shadow: none;
      border-color: var(--palm-300);
    }
    .banner[data-tone='warning'] {
      --tint: var(--laterite-50);
      --strong: var(--laterite-500);
      --on-strong: var(--sand-0);
    }
    .banner[data-tone='danger'] {
      --tint: var(--crimson-50);
      --strong: var(--crimson-600);
      --on-strong: var(--sand-0);
    }
    .banner__icon {
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      border: var(--stroke) solid var(--ink-900);
      border-radius: 50%;
      background: var(--strong);
      color: var(--on-strong);
    }
    .banner__text {
      display: grid;
      gap: 0.2rem;
      min-width: 0;
    }
    h2 {
      font-size: 1.2rem;
    }
    p {
      color: var(--ink-700);
      max-width: 46rem;
    }
    .btn {
      grid-column: 1 / -1;
    }
    @media (min-width: 48rem) {
      .btn {
        grid-column: auto;
      }
    }
    .steps {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      margin-top: 0.45rem;
    }
    .steps span {
      width: 2rem;
      height: 0.45rem;
      border-radius: var(--r-pill);
      background: rgb(31 26 20 / 0.16);
      transition: background-color var(--dur-3) var(--ease-out);
    }
    .steps span.is-done {
      background: var(--ink-900);
    }
    .steps small {
      margin-left: 0.5rem;
      font-size: var(--fs-xs);
      font-weight: 650;
      color: var(--ink-700);
    }
  `,
})
export class VerificationBanner {
  readonly profile = input.required<DriverProfile | null>();

  protected readonly progress = computed(() => {
    const profile = this.profile();
    const status = profile?.verificationStatus;
    if (profile && status !== VerificationStatus.Incomplete) return null;
    const steps = onboardingSteps(profile?.partnerType ?? null).map((step) => isStepDone(profile, step));
    return { steps, done: steps.filter(Boolean).length, total: steps.length };
  });

  protected readonly banner = computed<Banner>(() => {
    const profile = this.profile();
    if (!profile) {
      return {
        tone: 'accent',
        icon: 'flag',
        title: 'Set up your partner profile',
        text: 'Tell us about yourself and your vehicle, then upload your documents. You can stop and pick it up again at any point.',
        action: { label: 'Start', link: '/partner/onboarding' },
      };
    }
    switch (profile.verificationStatus) {
      case VerificationStatus.Incomplete:
        return {
          tone: 'accent',
          icon: 'flag',
          title: profile.onboarding.readyForReview ? 'Everything is in — send it for review' : 'Finish getting verified',
          text: profile.onboarding.readyForReview
            ? 'Your profile and documents are complete. Submit them and our team will check them.'
            : 'Travellers only see verified drivers. Complete the remaining steps to be listed.',
          action: { label: profile.onboarding.readyForReview ? 'Review and submit' : 'Continue', link: '/partner/onboarding' },
        };
      case VerificationStatus.Pending:
        return {
          tone: 'accent',
          icon: 'clock',
          title: 'Your documents are being checked',
          text: 'Nothing more is needed from you right now. You will get a notification as soon as a decision is made.',
          action: { label: 'See what was sent', link: '/partner/documents' },
        };
      case VerificationStatus.ChangesRequested:
        return {
          tone: 'warning',
          icon: 'alert',
          title: 'Some documents need fixing',
          text: 'Our team could not accept everything. Replace the documents marked “Rejected”, then submit again.',
          action: { label: 'Fix documents', link: '/partner/documents' },
        };
      case VerificationStatus.Rejected:
        return {
          tone: 'danger',
          icon: 'alert-circle',
          title: 'Your application was not approved',
          text: 'You can correct your details and documents and submit again. If you think this is a mistake, contact support.',
          action: { label: 'Review my application', link: '/partner/onboarding' },
        };
      case VerificationStatus.Suspended:
        return {
          tone: 'danger',
          icon: 'lock',
          title: 'Your listing is suspended',
          text: 'You cannot go online or receive requests while suspended. Contact support to find out why and what to do.',
          action: { label: 'Contact support', link: '/help' },
        };
      default:
        return {
          tone: 'success',
          icon: 'shield-check',
          title: 'You are verified',
          text: 'Go online to appear in searches and receive ride requests.',
        };
    }
  });
}
