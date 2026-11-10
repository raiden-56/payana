import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { StatePanel } from '@ui/primitives';
import { PartnerStore } from '../partner.store';
import { PartnerHead } from '../shared/page-head';
import { ProfileForm } from './profile-form';

/** Edit the public partner profile after onboarding. */
@Component({
  selector: 'app-partner-profile',
  imports: [StatePanel, PartnerHead, ProfileForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-partner-head heading="Your profile" lead="What customers see when they open your listing." back="/partner" backLabel="Dashboard" />
    @switch (store.profile.status()) {
      @case ('error') {
        <app-state-panel [error]="store.profile.error()" (retry)="store.profile.load()" />
      }
      @case ('ready') {
        <section class="card"><app-profile-form [profile]="store.profile.data()" /></section>
      }
      @default {
        <span class="skeleton" style="height: 30rem; border-radius: var(--r-lg)" aria-hidden="true"></span>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 56rem;
    }
  `,
})
export class Profile {
  protected readonly store = inject(PartnerStore);
}
