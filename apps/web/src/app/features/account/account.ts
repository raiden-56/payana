import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { tap } from 'rxjs';
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  INDIAN_MOBILE_E164,
  Locale,
  MAX_SAVED_PLACES,
  type Place,
  type SavedPlace,
} from '@payana/contracts';
import { ConsentStore } from '@core/analytics/consent.store';
import { MeApi } from '@core/api/customer.api';
import { AuthStore } from '@core/auth/auth.store';
import { BRAND } from '@core/brand';
import { DateOnlyPipe, PhonePipe, RelativeTimePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { LocationPicker } from '@ui/location-picker';
import { Avatar, Modal, StatePanel } from '@ui/primitives';

const LOCALES: { value: Locale; label: string }[] = [
  { value: Locale.En, label: 'English' },
  { value: Locale.Kn, label: 'ಕನ್ನಡ (Kannada)' },
  { value: Locale.Hi, label: 'हिन्दी (Hindi)' },
];

const PLACE_KINDS: { value: SavedPlace['kind']; label: string }[] = [
  { value: 'stay', label: 'Where I am staying' },
  { value: 'home', label: 'Home' },
  { value: 'work', label: 'Work' },
  { value: 'other', label: 'Other' },
];

/**
 * Account & privacy: who you are, the places and contact you keep on file,
 * what you have consented to, where you are signed in, and how to leave.
 */
@Component({
  selector: 'app-account',
  imports: [ReactiveFormsModule, RouterLink, Icon, Avatar, Modal, StatePanel, LocationPicker, PhonePipe, DateOnlyPipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class Account {
  private readonly api = inject(MeApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly consentStore = inject(ConsentStore);
  protected readonly auth = inject(AuthStore);

  protected readonly brand = BRAND.name;
  protected readonly locales = LOCALES;
  protected readonly placeKinds = PLACE_KINDS;
  protected readonly maxPlaces = MAX_SAVED_PLACES;
  protected readonly graceDays = ACCOUNT_DELETION_GRACE_DAYS;

  // --- profile -------------------------------------------------------------------
  protected readonly profile = new FormGroup({
    displayName: new FormControl(this.auth.me()?.displayName ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(60)],
    }),
    email: new FormControl(this.auth.me()?.email ?? '', { nonNullable: true, validators: [Validators.email] }),
    locale: new FormControl<Locale>(this.auth.me()?.locale ?? Locale.En, { nonNullable: true }),
  });
  protected readonly savingProfile = signal(false);

  // --- emergency contact -----------------------------------------------------------
  protected readonly contact = loader(() =>
    this.api.emergencyContact().pipe(
      tap((c) =>
        this.contactForm.reset({ name: c?.name ?? '', phone: (c?.phone ?? '').replace(/^\+91/, ''), relationship: c?.relationship ?? '' }),
      ),
    ),
  );
  protected readonly contactForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)] }),
    relationship: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
  });
  protected readonly savingContact = signal(false);

  // --- saved places -----------------------------------------------------------------
  protected readonly places = loader(() => this.api.savedPlaces());
  protected readonly newPlace = signal<Place | null>(null);
  protected readonly newPlaceLabel = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] });
  protected readonly newPlaceKind = new FormControl<SavedPlace['kind']>('stay', { nonNullable: true });
  protected readonly addingPlace = signal(false);
  protected readonly placesFull = computed(() => (this.places.data()?.length ?? 0) >= MAX_SAVED_PLACES);

  // --- privacy ------------------------------------------------------------------------
  protected readonly consents = loader(() => this.api.consents());
  protected readonly savingConsents = signal(false);
  protected readonly deletion = loader(() => this.api.deletionRequest());
  protected readonly deleteOpen = signal(false);
  protected readonly deleteReason = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] });
  protected readonly deleteBusy = signal(false);

  // --- devices --------------------------------------------------------------------------
  protected readonly sessions = loader(() => this.api.sessions());
  protected readonly revoking = signal<string | null>(null);

  constructor() {
    this.contact.load();
    this.places.load();
    this.consents.load();
    this.deletion.load();
    this.sessions.load();
  }

  protected bad(control: FormControl): 'true' | null {
    return control.invalid && control.touched ? 'true' : null;
  }

  // --- profile -------------------------------------------------------------------

  protected saveProfile(): void {
    this.profile.markAllAsTouched();
    if (this.profile.invalid || this.savingProfile()) return;
    const v = this.profile.getRawValue();
    this.savingProfile.set(true);
    this.api.update({ displayName: v.displayName.trim(), email: v.email.trim() || null, locale: v.locale }).subscribe({
      next: (me) => {
        this.savingProfile.set(false);
        this.auth.setMe(me);
        this.profile.markAsPristine();
        this.toasts.success('Profile saved.');
      },
      error: (error: unknown) => {
        this.savingProfile.set(false);
        this.toasts.error(error);
      },
    });
  }

  // --- emergency contact -----------------------------------------------------------

  protected saveContact(): void {
    this.contactForm.markAllAsTouched();
    if (this.contactForm.invalid || this.savingContact()) return;
    const v = this.contactForm.getRawValue();
    const phone = '+91' + v.phone;
    if (!INDIAN_MOBILE_E164.test(phone)) return;
    this.savingContact.set(true);
    this.api.saveEmergencyContact({ name: v.name.trim(), phone, relationship: v.relationship.trim() || undefined }).subscribe({
      next: (saved) => {
        this.savingContact.set(false);
        this.contact.set(saved);
        this.contactForm.markAsPristine();
        this.toasts.success('Emergency contact saved.');
      },
      error: (error: unknown) => {
        this.savingContact.set(false);
        this.toasts.error(error);
      },
    });
  }

  protected removeContact(): void {
    this.savingContact.set(true);
    this.api.removeEmergencyContact().subscribe({
      next: () => {
        this.savingContact.set(false);
        this.contact.set(null);
        this.contactForm.reset({ name: '', phone: '', relationship: '' });
        this.toasts.info('Emergency contact removed.');
      },
      error: (error: unknown) => {
        this.savingContact.set(false);
        this.toasts.error(error);
      },
    });
  }

  // --- saved places -----------------------------------------------------------------

  protected addPlace(): void {
    const place = this.newPlace();
    if (!place || this.addingPlace() || this.placesFull()) return;
    this.addingPlace.set(true);
    this.api
      .addSavedPlace({
        label: this.newPlaceLabel.value.trim() || place.label,
        address: place.address,
        location: place.location,
        kind: this.newPlaceKind.value,
      })
      .subscribe({
        next: (saved) => {
          this.addingPlace.set(false);
          this.places.update((list) => [...list, saved]);
          this.newPlace.set(null);
          this.newPlaceLabel.reset('');
          this.toasts.success('Place saved.');
        },
        error: (error: unknown) => {
          this.addingPlace.set(false);
          this.toasts.error(error);
        },
      });
  }

  protected removePlace(place: SavedPlace): void {
    this.api.removeSavedPlace(place.id).subscribe({
      next: () => this.places.update((list) => list.filter((p) => p.id !== place.id)),
      error: (error: unknown) => this.toasts.error(error),
    });
  }

  // --- privacy ------------------------------------------------------------------------

  protected setConsent(key: 'analytics' | 'advertising' | 'marketingMessages', value: boolean): void {
    const current = this.consents.data();
    if (!current || this.savingConsents()) return;
    const next = { analytics: current.analytics, advertising: current.advertising, marketingMessages: current.marketingMessages, [key]: value };
    this.savingConsents.set(true);
    this.api.saveConsents(next).subscribe({
      next: (saved) => {
        this.savingConsents.set(false);
        this.consents.set(saved);
        // The same choice drives what loads in this browser.
        this.consentStore.save({ analytics: saved.analytics, advertising: saved.advertising });
        this.toasts.success('Privacy choice saved.');
      },
      error: (error: unknown) => {
        this.savingConsents.set(false);
        this.toasts.error(error);
        this.consents.load({ silent: true });
      },
    });
  }

  protected requestDeletion(): void {
    if (this.deleteBusy()) return;
    this.deleteBusy.set(true);
    this.api.requestDeletion({ reason: this.deleteReason.value.trim() || undefined }).subscribe({
      next: (status) => {
        this.deleteBusy.set(false);
        this.deleteOpen.set(false);
        this.deletion.set(status);
        this.toasts.info('Deletion scheduled. You can cancel it until then.');
      },
      error: (error: unknown) => {
        this.deleteBusy.set(false);
        this.deleteOpen.set(false);
        this.toasts.error(error);
      },
    });
  }

  protected cancelDeletion(): void {
    this.deleteBusy.set(true);
    this.api.cancelDeletion().subscribe({
      next: (status) => {
        this.deleteBusy.set(false);
        this.deletion.set(status);
        this.toasts.success('Your account will be kept.');
      },
      error: (error: unknown) => {
        this.deleteBusy.set(false);
        this.toasts.error(error);
      },
    });
  }

  // --- devices --------------------------------------------------------------------------

  protected revoke(sessionId: string): void {
    this.revoking.set(sessionId);
    this.api.revokeSession(sessionId).subscribe({
      next: () => {
        this.revoking.set(null);
        this.sessions.update((list) => list.filter((s) => s.id !== sessionId));
        this.toasts.success('That device has been signed out.');
      },
      error: (error: unknown) => {
        this.revoking.set(null);
        this.toasts.error(error);
      },
    });
  }

  protected signOut(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/'));
  }
}
