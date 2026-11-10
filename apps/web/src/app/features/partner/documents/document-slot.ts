import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { switchMap } from 'rxjs';
import {
  DocumentType,
  UPLOAD_ALLOWED_CONTENT_TYPES,
  UploadPurpose,
  type DriverDocument,
  type SubmitDocumentRequest,
} from '@payana/contracts';
import { toApiError } from '@core/api/api-error';
import { PartnerApi, UploadsApi } from '@core/api/partner.api';
import { DateOnlyPipe } from '@core/util/format';
import { ToastService } from '@core/util/toast.service';
import { Icon, type IconName } from '@ui/icon';
import { EXPIRY_REQUIRED, documentSlot, toIsoDate, type DocumentSlotState } from '../partner-logic';
import { FilePick } from '../shared/file-pick';
import { fieldErrors } from '../shared/form-errors';
import { DOCUMENT, REJECTION_REASON } from '../shared/labels';

const STATE: Record<DocumentSlotState, { label: string; tone: string; icon: IconName }> = {
  missing: { label: 'Not uploaded', tone: 'neutral', icon: 'upload' },
  in_review: { label: 'In review', tone: 'warning', icon: 'clock' },
  approved: { label: 'Approved', tone: 'success', icon: 'check' },
  expiring: { label: 'Expiring soon', tone: 'warning', icon: 'alert' },
  expired: { label: 'Expired', tone: 'danger', icon: 'alert-circle' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'alert-circle' },
};

let nextId = 0;

/**
 * One document a partner has to hold: what it is, where it stands, and the
 * form to upload or replace it. The file goes up first; its key is then
 * attached to the document record together with the number and expiry date.
 */
@Component({
  selector: 'app-document-slot',
  imports: [ReactiveFormsModule, Icon, FilePick, DateOnlyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './document-slot.html',
  styleUrl: './document-slot.scss',
  host: { '[attr.data-state]': 'slot().state' },
})
export class DocumentSlotCard {
  readonly type = input.required<DocumentType>();
  /** The vehicle this document belongs to; null for documents about the person. */
  readonly vehicleId = input<string | null>(null);
  readonly document = input<DriverDocument | undefined>(undefined);
  readonly optional = input(false);
  readonly submitted = output<DriverDocument>();

  private readonly api = inject(PartnerApi);
  private readonly uploads = inject(UploadsApi);
  private readonly toasts = inject(ToastService);

  protected readonly uid = `doc-${nextId++}`;
  protected readonly fileTypes = UPLOAD_ALLOWED_CONTENT_TYPES;
  protected readonly today = toIsoDate(new Date());

  protected readonly form = new FormGroup({
    documentNumber: new FormControl('', {
      nonNullable: true,
      validators: [Validators.minLength(4), Validators.maxLength(40), Validators.pattern(/^[A-Za-z0-9\s/-]+$/)],
    }),
    expiresOn: new FormControl('', { nonNullable: true }),
  });

  protected readonly errors = fieldErrors(
    this.form,
    {
      documentNumber: {
        minlength: 'Enter at least 4 characters.',
        maxlength: 'Keep it under 40 characters.',
        pattern: 'Use letters, digits, spaces, “/” or “-” only.',
      },
    },
    { fileKey: 'file' },
    ['file'],
  );

  protected readonly open = signal(false);
  protected readonly file = signal<File | null>(null);
  protected readonly busy = signal(false);
  protected readonly stage = signal<'idle' | 'uploading' | 'saving'>('idle');
  protected readonly problem = signal('');

  private readonly picker = viewChild(FilePick);

  protected readonly info = computed(() => DOCUMENT[this.type()]);
  protected readonly slot = computed(() => documentSlot(this.document(), new Date()));
  protected readonly state = computed(() => STATE[this.slot().state]);
  protected readonly expiryRequired = computed(() => EXPIRY_REQUIRED.includes(this.type()));

  protected readonly rejection = computed(() => {
    const doc = this.document();
    return doc?.rejectionReason ? REJECTION_REASON[doc.rejectionReason] : '';
  });

  protected readonly expiryText = computed(() => {
    const { state, daysLeft } = this.slot();
    if (daysLeft === null) return '';
    if (state === 'expired') return daysLeft < 0 ? `Expired ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago` : 'Expired';
    if (daysLeft === 0) return 'Expires today';
    if (state === 'expiring') return `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    return '';
  });

  protected readonly actionLabel = computed(() => {
    switch (this.slot().state) {
      case 'missing':
        return 'Upload';
      case 'rejected':
      case 'expired':
      case 'expiring':
        return 'Upload a new one';
      default:
        return 'Replace';
    }
  });

  protected toggle(): void {
    this.open.update((v) => !v);
    this.problem.set('');
  }

  protected onFile(files: File[]): void {
    this.file.set(files[0] ?? null);
    this.errors.clearField('file');
  }

  protected submit(): void {
    if (this.busy()) return;
    this.problem.set('');
    const valid = this.errors.validate();

    const file = this.file();
    if (!file) this.errors.set('file', 'Choose the photo or PDF of this document.');
    const { documentNumber, expiresOn } = this.form.getRawValue();
    if (this.expiryRequired() && !expiresOn) this.errors.set('expiresOn', 'Enter the expiry date printed on the document.');
    else if (expiresOn && expiresOn < this.today) this.errors.set('expiresOn', 'This date has passed. Upload the renewed document.');
    if (!valid || !file || this.errors.hasMessages()) return;

    const body: Omit<SubmitDocumentRequest, 'fileKey'> = {
      type: this.type(),
      ...(this.vehicleId() ? { vehicleId: this.vehicleId()! } : {}),
      ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
      ...(expiresOn ? { expiresOn } : {}),
    };

    this.busy.set(true);
    this.stage.set('uploading');
    this.uploads
      .upload(file, UploadPurpose.DriverDocument)
      .pipe(
        switchMap((fileKey) => {
          this.stage.set('saving');
          return this.api.submitDocument({ ...body, fileKey });
        }),
      )
      .subscribe({
        next: (document) => {
          this.busy.set(false);
          this.stage.set('idle');
          this.open.set(false);
          this.file.set(null);
          this.picker()?.reset();
          this.form.reset({ documentNumber: '', expiresOn: '' });
          this.toasts.success(`${this.info().label} sent for review.`);
          this.submitted.emit(document);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.stage.set('idle');
          const apiError = toApiError(error);
          const unplaced = this.errors.accept(apiError);
          this.problem.set(unplaced[0] ?? (apiError.fieldErrors.length ? '' : (apiError.problem?.detail ?? apiError.message)));
        },
      });
  }
}
