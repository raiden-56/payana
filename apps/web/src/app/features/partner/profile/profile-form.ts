import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, of, switchMap } from 'rxjs';
import {
  ErrorCode,
  PartnerType,
  RegionStatus,
  UploadPurpose,
  VerificationStatus,
  type DriverProfile,
  type UpsertDriverProfileRequest,
} from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi, UploadsApi } from '@core/api/partner.api';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Avatar } from '@ui/primitives';
import { PartnerStore } from '../partner.store';
import { FilePick } from '../shared/file-pick';
import { fieldErrors } from '../shared/form-errors';
import { LANGUAGE_CHOICES, PARTNER_TYPE, WEEKDAYS } from '../shared/labels';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_LANGUAGES = 6;
const BIO_MAX = 600;

/** Who the partner is and where they work. Used in onboarding and on the profile screen. */
@Component({
  selector: 'app-profile-form',
  imports: [ReactiveFormsModule, Icon, Avatar, FilePick],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-form.html',
  styleUrl: './profile-form.scss',
})
export class ProfileForm {
  readonly profile = input.required<DriverProfile | null>();
  readonly submitLabel = input('Save profile');
  readonly saved = output<DriverProfile>();

  private readonly api = inject(PartnerApi);
  private readonly uploads = inject(UploadsApi);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PartnerStore);

  protected readonly partnerTypes = Object.values(PartnerType).map((value) => ({ value, ...PARTNER_TYPE[value] }));
  protected readonly languageChoices = LANGUAGE_CHOICES;
  protected readonly weekdays = WEEKDAYS;
  protected readonly photoTypes = PHOTO_TYPES;
  protected readonly bioMax = BIO_MAX;
  protected readonly maxLanguages = MAX_LANGUAGES;

  protected readonly form = new FormGroup({
    displayName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(60)],
    }),
    bio: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(BIO_MAX)] }),
    yearsExperience: new FormControl<number | null>(null, [Validators.min(0), Validators.max(60)]),
    hoursFrom: new FormControl('07:00', { nonNullable: true }),
    hoursTo: new FormControl('21:00', { nonNullable: true }),
  });

  protected readonly errors = fieldErrors(
    this.form,
    {
      displayName: { required: 'Enter the name customers will see.', minlength: 'Use at least 2 characters.', maxlength: 'Keep it under 60 characters.' },
      bio: { maxlength: `Keep it under ${BIO_MAX} characters.` },
      yearsExperience: { min: 'Enter 0 or more.', max: 'Enter 60 or fewer.' },
    },
    { photoKey: 'photo' },
    ['partnerType', 'languages', 'serviceAreas', 'operatingHours', 'photo'],
  );

  protected readonly partnerType = signal<PartnerType>(PartnerType.OwnerDriver);
  protected readonly languages = signal<string[]>([]);
  protected readonly areas = signal<string[]>([]);
  protected readonly setHours = signal(false);
  protected readonly days = signal<number[]>([0, 1, 2, 3, 4, 5, 6]);
  protected readonly otherLanguage = signal('');
  protected readonly photo = signal<File | null>(null);
  protected readonly removePhoto = signal(false);
  protected readonly busy = signal(false);
  protected readonly problem = signal('');

  protected readonly regions = computed(() =>
    (this.store.regions.data() ?? []).filter((r) => r.status !== RegionStatus.Hidden),
  );

  /** The partner type decides which documents are needed, so it is fixed once review has started. */
  protected readonly typeLocked = computed(() => {
    const status = this.profile()?.verificationStatus;
    return (
      !!status &&
      status !== VerificationStatus.Incomplete &&
      status !== VerificationStatus.ChangesRequested &&
      status !== VerificationStatus.Rejected
    );
  });

  /** Languages in use that are not among the suggested ones. */
  protected readonly customLanguages = computed(() =>
    this.languages().filter((l) => !(LANGUAGE_CHOICES as readonly string[]).includes(l)),
  );

  constructor() {
    // Fill the form when the profile arrives or changes underneath us.
    effect(() => {
      const p = this.profile();
      untracked(() => this.fill(p));
    });
  }

  private fill(p: DriverProfile | null): void {
    if (!p) return;
    this.form.reset({
      displayName: p.displayName,
      bio: p.bio ?? '',
      yearsExperience: p.yearsExperience,
      hoursFrom: p.operatingHours?.from ?? '07:00',
      hoursTo: p.operatingHours?.to ?? '21:00',
    });
    this.partnerType.set(p.partnerType);
    this.languages.set([...p.languages]);
    this.areas.set([...p.serviceAreas]);
    this.setHours.set(!!p.operatingHours);
    this.days.set(p.operatingHours ? [...p.operatingHours.days] : [0, 1, 2, 3, 4, 5, 6]);
    this.photo.set(null);
    this.removePhoto.set(false);
  }

  protected chooseType(type: PartnerType): void {
    if (this.typeLocked()) return;
    this.partnerType.set(type);
    this.errors.clearField('partnerType');
  }

  protected toggleLanguage(language: string): void {
    this.errors.clearField('languages');
    this.languages.update((list) => {
      if (list.includes(language)) return list.filter((l) => l !== language);
      if (list.length >= MAX_LANGUAGES) {
        this.errors.set('languages', `Choose at most ${MAX_LANGUAGES} languages.`);
        return list;
      }
      return [...list, language];
    });
  }

  protected addOtherLanguage(): void {
    const value = this.otherLanguage().trim();
    if (!value) return;
    if (value.length < 2 || value.length > 30) {
      this.errors.set('languages', 'A language name is 2 to 30 characters long.');
      return;
    }
    const known = this.languages().some((l) => l.toLowerCase() === value.toLowerCase());
    if (!known) this.toggleLanguage(value.charAt(0).toUpperCase() + value.slice(1));
    this.otherLanguage.set('');
  }

  protected toggleArea(slug: string): void {
    this.errors.clearField('serviceAreas');
    this.areas.update((list) => (list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]));
  }

  protected toggleDay(day: number): void {
    this.errors.clearField('operatingHours');
    this.days.update((list) => (list.includes(day) ? list.filter((d) => d !== day) : [...list, day].sort()));
  }

  protected onPhoto(files: File[]): void {
    this.photo.set(files[0] ?? null);
    if (files.length) this.removePhoto.set(false);
    this.errors.clearField('photo');
  }

  protected save(): void {
    if (this.busy()) return;
    const formValid = this.errors.validate();
    this.problem.set('');

    if (!this.languages().length) this.errors.set('languages', 'Choose at least one language you speak with customers.');
    if (!this.areas().length) this.errors.set('serviceAreas', 'Choose at least one town you work in.');
    const { hoursFrom, hoursTo } = this.form.getRawValue();
    if (this.setHours()) {
      if (!this.days().length) this.errors.set('operatingHours', 'Choose at least one working day.');
      else if (!hoursFrom || !hoursTo) this.errors.set('operatingHours', 'Enter both a start and an end time.');
      else if (hoursFrom === hoursTo) this.errors.set('operatingHours', 'Start and end time cannot be the same.');
    }
    if (!formValid || this.errors.hasMessages()) {
      this.problem.set('Some details need fixing. Check the highlighted fields.');
      return;
    }

    const value = this.form.getRawValue();
    const body: UpsertDriverProfileRequest = {
      partnerType: this.partnerType(),
      displayName: value.displayName.trim(),
      bio: value.bio.trim() || null,
      languages: this.languages(),
      yearsExperience: value.yearsExperience,
      serviceAreas: this.areas(),
      operatingHours: this.setHours() ? { days: this.days(), from: value.hoursFrom, to: value.hoursTo } : null,
    };

    this.busy.set(true);
    // The photo is uploaded first; its key travels with the profile.
    const photo = this.photo();
    const withPhoto: Observable<UpsertDriverProfileRequest> = photo
      ? this.uploads.upload(photo, UploadPurpose.ProfilePhoto).pipe(switchMap((photoKey) => of({ ...body, photoKey })))
      : of(this.removePhoto() ? { ...body, photoKey: null } : body);

    withPhoto.pipe(switchMap((request) => this.api.saveProfile(request))).subscribe({
      next: (profile) => {
        this.busy.set(false);
        this.store.setProfile(profile);
        this.toasts.success('Profile saved.');
        this.saved.emit(profile);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const apiError = toApiError(error);
        const unplaced = this.errors.accept(apiError);
        this.problem.set(
          apiError.is(ErrorCode.FeatureDisabled)
            ? 'New driver sign-ups are paused at the moment. Please try again later.'
            : (unplaced[0] ?? apiError.problem?.detail ?? apiError.message),
        );
      },
    });
  }
}
