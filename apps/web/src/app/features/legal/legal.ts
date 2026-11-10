import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BRAND } from '@core/brand';
import { ConsentStore } from '@core/analytics/consent.store';
import { Icon } from '@ui/icon';

/**
 * Privacy notice and terms of use.
 *
 * DRAFT TEXT. These describe how the software actually behaves, so they are a
 * sound starting point, but they have not been reviewed by a lawyer and do not
 * name the legal entity, its address or a grievance officer (DPDP Act 2023).
 * Both are listed as launch blockers in specs/deployment/release-plan.md.
 */
@Component({
  selector: 'app-legal',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <article class="container container--narrow doc">
        <p class="draft"><app-icon name="alert" [size]="16" /> Draft for review — not yet legal advice-checked.</p>
        @if (isPrivacy()) {
          <h1>Privacy notice</h1>
          <p class="lead">What {{ brand }} collects, why, who sees it, and what you can do about it.</p>

          <h2>What we collect</h2>
          <ul>
            <li><strong>Your mobile number</strong> — to sign you in with a one-time code.</li>
            <li><strong>Your name, and optionally e-mail</strong> — so a driver knows who to look for, and for receipts.</li>
            <li><strong>Pickup and drop points</strong> you choose, and your position only when you tap “use my current location”.</li>
            <li><strong>Trips</strong>: requests, quotes, bookings, reviews and support messages.</li>
            <li><strong>Drivers and owners</strong>: identity and vehicle documents, for verification, and position while they are online.</li>
          </ul>

          <h2>Who sees it</h2>
          <ul>
            <li>A driver sees your name and number <strong>only after you accept their quote</strong>, and only while that booking is active.</li>
            <li>Before that, drivers see the trip and your first name only. The public never sees a driver’s exact position — only distance and direction.</li>
            <li>Our support and verification staff see what their role needs. Every staff action is logged.</li>
          </ul>

          <h2>Analytics and advertising</h2>
          <p>
            Google Analytics and Google Ads load only if you say yes in the privacy banner. No names, phone numbers or e-mail
            addresses are sent to them, and page addresses are reported without booking or driver IDs.
            <button type="button" class="link" (click)="consent.preferencesOpen.set(true)">Change your choice</button>
          </p>

          <h2>Your rights</h2>
          <p>
            You can see and correct your details, withdraw consent and delete your account at any time from
            <a class="link" routerLink="/account">Account &amp; privacy</a>. Deletion happens after a cooling-off period;
            completed booking records are kept without your personal details where the law requires.
          </p>
        } @else {
          <h1>Terms of use</h1>
          <p class="lead">The short version: {{ brand }} introduces you to independent local drivers. The trip is between you and the driver.</p>

          <h2>What {{ brand }} is</h2>
          <p>A marketplace. Drivers and vehicle owners list themselves, quote their own prices and provide the trips. We verify their documents, show you their quotes and record the booking. We do not employ the drivers or operate the vehicles.</p>

          <h2>Quotes and payment</h2>
          <ul>
            <li>A quote is the driver’s price for the trip as described. Changes on the way are agreed between you and the driver.</li>
            <li>You pay the driver directly. Any platform booking fee is shown before you accept.</li>
            <li>Each booking shows the cancellation policy that applies to it.</li>
          </ul>

          <h2>Reasonable use</h2>
          <ul>
            <li>Give accurate trip details and turn up, or cancel in good time.</li>
            <li>Reviews must be honest and about a real trip.</li>
            <li>Drivers must keep their documents current; listings with lapsed documents are hidden until renewed.</li>
          </ul>

          <h2>Problems</h2>
          <p>Use “Report a problem” on the booking, or the <a class="link" routerLink="/help">help centre</a>. In an emergency, call 112 first.</p>
        }
      </article>
    </section>
  `,
  styles: `
    .doc { display: grid; gap: var(--s-4); }
    .doc h2 { font-size: var(--fs-h4); margin-top: var(--s-4); }
    .doc ul { display: grid; gap: 0.5rem; padding-left: 1.2rem; list-style: disc; }
    .doc p, .doc li { color: var(--ink-700); max-width: 44rem; }
    .lead { font-size: var(--fs-lg); }
    .draft { display: inline-flex; align-items: center; gap: 0.4rem; justify-self: start; padding: 0.3rem 0.8rem; border-radius: var(--r-pill); background: var(--marigold-100); font-size: var(--fs-sm); font-weight: 650; }
  `,
})
export class Legal {
  /** From route data: 'privacy' | 'terms'. */
  readonly doc = input<string>('privacy');
  protected readonly brand = BRAND.name;
  protected readonly consent = inject(ConsentStore);
  protected readonly isPrivacy = computed(() => this.doc() !== 'terms');
}
