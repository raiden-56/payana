import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, concatMap, from, of, switchMap, toArray } from 'rxjs';
import { ErrorCode, UploadPurpose, VerificationStatus, type UpsertVehicleRequest, type Vehicle } from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi, UploadsApi } from '@core/api/partner.api';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { VehicleArt } from '@ui/vehicle-art';
import { formatRegistration, normalizeRegistration } from '../partner-logic';
import { PartnerStore } from '../partner.store';
import { FilePick } from '../shared/file-pick';
import { fieldErrors } from '../shared/form-errors';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_PHOTOS = 6;
const THIS_YEAR = new Date().getFullYear();

function registrationValidator(control: AbstractControl<string>): ValidationErrors | null {
  if (!control.value) return null;
  return normalizeRegistration(control.value) ? null : { registration: true };
}

/** Add or edit a vehicle. Used in onboarding and on the vehicles screen. */
@Component({
  selector: 'app-vehicle-form',
  imports: [ReactiveFormsModule, RouterLink, Icon, VehicleArt, FilePick],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vehicle-form.html',
  styleUrl: './vehicle-form.scss',
})
export class VehicleForm {
  /** The vehicle being edited, or null to add a new one. */
  readonly vehicle = input<Vehicle | null>(null);
  readonly submitLabel = input('');
  readonly cancellable = input(false);
  readonly saved = output<Vehicle>();
  readonly cancelled = output<void>();

  private readonly api = inject(PartnerApi);
  private readonly uploads = inject(UploadsApi);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PartnerStore);

  protected readonly photoTypes = PHOTO_TYPES;
  protected readonly maxPhotos = MAX_PHOTOS;
  protected readonly maxYear = THIS_YEAR + 1;

  protected readonly form = new FormGroup({
    categoryCode: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    make: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(40)] }),
    model: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
    year: new FormControl<number | null>(null, [Validators.min(1990), Validators.max(THIS_YEAR + 1)]),
    color: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
    registrationNumber: new FormControl('', { nonNullable: true, validators: [Validators.required, registrationValidator] }),
    seats: new FormControl<number | null>(null, [Validators.required, Validators.min(1), Validators.max(60)]),
    luggageCapacity: new FormControl<number | null>(0, [Validators.required, Validators.min(0), Validators.max(60)]),
    hasAc: new FormControl(false, { nonNullable: true }),
  });

  protected readonly errors = fieldErrors(
    this.form,
    {
      categoryCode: { required: 'Choose the kind of vehicle.' },
      make: { required: 'Enter the make, for example Bajaj or Maruti Suzuki.', minlength: 'Use at least 2 characters.' },
      model: { required: 'Enter the model, for example RE or Dzire.' },
      year: { min: 'Enter 1990 or later.', max: `Enter ${THIS_YEAR + 1} or earlier.` },
      registrationNumber: {
        required: 'Enter the registration number as printed on the RC.',
        registration: 'That is not a registration number. It looks like KA 47 A 4821.',
      },
      seats: { required: 'Enter how many passengers it seats.', min: 'At least 1 seat.', max: 'At most 60 seats.' },
      luggageCapacity: { required: 'Enter 0 if it carries no bags.', min: 'Enter 0 or more.', max: 'At most 60 bags.' },
    },
    { photoKeys: 'photos' },
    ['photos'],
  );

  protected readonly photos = signal<File[]>([]);
  protected readonly previews = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly problem = signal('');
  protected readonly planLimit = signal(false);
  private readonly categoryCode = signal('');

  protected readonly categories = computed(() => (this.store.categories.data() ?? []).filter((c) => c.isActive));
  protected readonly selectedCategory = computed(() => this.store.categoryByCode().get(this.categoryCode()));
  protected readonly isEdit = computed(() => this.vehicle() !== null);
  protected readonly label = computed(() => this.submitLabel() || (this.isEdit() ? 'Save changes' : 'Add vehicle'));

  constructor() {
    effect(() => {
      const v = this.vehicle();
      untracked(() => this.fill(v));
    });

    const sub = this.form.controls.categoryCode.valueChanges.subscribe((code) => this.onCategory(code));
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      this.releasePreviews();
    });
  }

  /**
   * Changing what the vehicle *is* invalidates the documents on file: the API
   * sends an approved vehicle back for review and clears its rates.
   */
  protected identityChanges(): boolean {
    const v = this.vehicle();
    if (!v || v.verificationStatus === VerificationStatus.Incomplete) return false;
    const { registrationNumber, categoryCode } = this.form.getRawValue();
    const registration = normalizeRegistration(registrationNumber) ?? registrationNumber;
    return registration !== v.registrationNumber || categoryCode !== v.categoryCode;
  }

  protected onRegistrationBlur(): void {
    const control = this.form.controls.registrationNumber;
    const normal = normalizeRegistration(control.value);
    if (normal) control.setValue(formatRegistration(normal), { emitEvent: false });
  }

  protected onPhotos(files: File[]): void {
    this.errors.clearField('photos');
    this.releasePreviews();
    this.photos.set(files);
    this.previews.set(files.map((file) => URL.createObjectURL(file)));
  }

  protected clearPhotos(): void {
    this.releasePreviews();
    this.photos.set([]);
    this.previews.set([]);
  }

  protected save(): void {
    if (this.busy()) return;
    this.problem.set('');
    this.planLimit.set(false);
    if (!this.errors.validate()) {
      this.problem.set('Some details need fixing. Check the highlighted fields.');
      return;
    }

    const value = this.form.getRawValue();
    const body: UpsertVehicleRequest = {
      categoryCode: value.categoryCode,
      make: value.make.trim(),
      model: value.model.trim(),
      year: value.year,
      color: value.color.trim() || null,
      registrationNumber: normalizeRegistration(value.registrationNumber)!,
      seats: value.seats!,
      luggageCapacity: value.luggageCapacity ?? 0,
      hasAc: value.hasAc,
    };

    this.busy.set(true);
    const files = this.photos();
    // Photos go up one at a time: kinder to a phone on mobile data than six uploads at once.
    const request: Observable<UpsertVehicleRequest> = files.length
      ? from(files).pipe(
          concatMap((file) => this.uploads.upload(file, UploadPurpose.VehiclePhoto)),
          toArray(),
          switchMap((photoKeys) => of({ ...body, photoKeys })),
        )
      : of(body);

    const existing = this.vehicle();
    request
      .pipe(switchMap((payload) => (existing ? this.api.updateVehicle(existing.id, payload) : this.api.addVehicle(payload))))
      .subscribe({
        next: (vehicle) => {
          this.busy.set(false);
          this.clearPhotos();
          this.store.refreshVehicles();
          this.store.refreshProfile();
          if (existing) this.store.refreshDocuments();
          this.toasts.success(existing ? 'Vehicle updated.' : 'Vehicle added.');
          this.saved.emit(vehicle);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          const apiError = toApiError(error);
          const unplaced = this.errors.accept(apiError);
          this.planLimit.set(apiError.is(ErrorCode.EntitlementExceeded));
          this.problem.set(unplaced[0] ?? apiError.problem?.detail ?? apiError.message);
        },
      });
  }

  private fill(v: Vehicle | null): void {
    this.clearPhotos();
    this.problem.set('');
    this.planLimit.set(false);
    this.errors.clear();
    if (!v) {
      this.form.reset({ categoryCode: '', make: '', model: '', year: null, color: '', registrationNumber: '', seats: null, luggageCapacity: 0, hasAc: false });
      this.categoryCode.set('');
      return;
    }
    this.form.reset(
      {
        categoryCode: v.categoryCode,
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color ?? '',
        registrationNumber: formatRegistration(v.registrationNumber),
        seats: v.seats,
        luggageCapacity: v.luggageCapacity,
        hasAc: v.hasAc,
      },
      { emitEvent: false },
    );
    this.categoryCode.set(v.categoryCode);
  }

  /** Picking a category on a new vehicle fills in its usual seats and luggage. */
  private onCategory(code: string): void {
    this.categoryCode.set(code);
    if (this.isEdit()) return;
    const category = this.store.categoryByCode().get(code);
    if (!category) return;
    const { seats, luggageCapacity } = this.form.controls;
    if (!seats.dirty) seats.setValue(category.seats);
    if (!luggageCapacity.dirty) luggageCapacity.setValue(category.luggageCapacity);
  }

  private releasePreviews(): void {
    for (const url of this.previews()) URL.revokeObjectURL(url);
  }
}
