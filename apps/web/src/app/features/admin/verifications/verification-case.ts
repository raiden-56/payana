import { ChangeDetectionStrategy, Component, computed, inject, input, signal, effect, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DocumentRejectionReason,
  DocumentStatus,
  ListingStatus,
  PERSON_DOCUMENT_TYPES,
  Permission,
  type AdminDocument,
  type Vehicle,
} from '@payana/contracts';
import { AdminApi } from '@core/api/admin.api';
import { AuthStore } from '@core/auth/auth.store';
import { DateTimePipe, HumanizePipe, PhonePipe } from '@core/util/format';
import { loader } from '@core/util/loader';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { Modal, StatePanel } from '@ui/primitives';
import { StatusBadge } from '@ui/status';
import { AdminCounts } from '../admin-layout';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { DocumentCard } from './document-card';
import {
  DOCUMENT_LABEL,
  PARTNER_LABEL,
  REJECTION_LABEL,
  decisionNeedsNote,
  decisionsFor,
  type Decision,
} from './labels';

interface DocumentGroup {
  title: string;
  subtitle: string;
  /** Registration numbers read better in a fixed-width face. */
  mono?: boolean;
  documents: AdminDocument[];
}

/**
 * One partner's verification case: profile, vehicles, every document with its
 * own approve / reject, and the overall decision. Each action is recorded in
 * the audit log by the API.
 */
@Component({
  selector: 'app-admin-verification-case',
  imports: [RouterLink, Icon, StatePanel, StatusBadge, Modal, ConfirmDialog, DocumentCard, DateTimePipe, PhonePipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './verification-case.html',
  styleUrl: './verification-case.scss',
})
export class VerificationCasePage {
  /** Route parameter: the driver profile id. */
  readonly id = input.required<string>();

  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly counts = inject(AdminCounts);

  protected readonly canReview = this.auth.hasPermission(Permission.VerificationReview);
  protected readonly canModerate = this.auth.hasPermission(Permission.ListingsModerate);
  protected readonly partnerLabel = PARTNER_LABEL;
  protected readonly rejectionReasons = Object.values(DocumentRejectionReason);
  protected readonly rejectionLabel = REJECTION_LABEL;
  protected readonly documentLabel = DOCUMENT_LABEL;

  protected readonly vcase = loader(() => this.api.verification(this.id()));
  protected readonly busy = signal(false);

  // --- documents ---
  protected readonly rejecting = signal<AdminDocument | null>(null);
  protected readonly rejectReason = signal<DocumentRejectionReason | ''>('');
  protected readonly rejectNote = signal('');
  protected readonly rejectTried = signal(false);

  protected readonly groups = computed<DocumentGroup[]>(() => {
    const data = this.vcase.data();
    if (!data) return [];
    const person = data.documents.filter((d) => !d.vehicleId || PERSON_DOCUMENT_TYPES.includes(d.type));
    const groups: DocumentGroup[] = [
      { title: 'About the person', subtitle: 'Identity and driving licence', documents: person },
    ];
    for (const vehicle of data.vehicles) {
      groups.push({
        title: `${vehicle.make} ${vehicle.model}`,
        subtitle: vehicle.registrationNumber,
        mono: true,
        documents: data.documents.filter((d) => d.vehicleId === vehicle.id && !person.includes(d)),
      });
    }
    // Anything attached to a vehicle that is no longer on the profile still has to be visible.
    const shown = new Set(groups.flatMap((g) => g.documents));
    const orphans = data.documents.filter((d) => !shown.has(d));
    if (orphans.length) groups.push({ title: 'Other documents', subtitle: 'Not linked to a current vehicle', documents: orphans });
    return groups;
  });

  protected readonly notApproved = computed(
    () => (this.vcase.data()?.documents ?? []).filter((d) => d.status !== DocumentStatus.Approved).length,
  );

  // --- overall decision ---
  protected readonly options = computed(() => decisionsFor(this.vcase.data()?.profile.verificationStatus ?? 'incomplete'));
  protected readonly decision = signal<Decision | null>(null);
  protected readonly decisionNote = signal('');
  protected readonly decisionTried = signal(false);
  protected readonly noteRequired = computed(() => !!this.decision() && decisionNeedsNote(this.decision()!));
  protected readonly noteMissing = computed(() => this.decisionTried() && this.noteRequired() && !this.decisionNote().trim());

  // --- listing moderation ---
  protected readonly moderating = signal<{ vehicle: Vehicle; to: ListingStatus } | null>(null);

  constructor() {
    // The router sets the id input after construction, and again when moving between records.
    effect(() => {
      this.id();
      untracked(() => this.vcase.load());
    });
  }

  /** "decision:request_changes" -> "Decision: request changes". */
  protected actionLabel(action: string): string {
    const text = action.replace(/[._]+/g, " ").replace(/s*:s*/g, ": ").trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ----- documents -----

  protected approveDocument(doc: AdminDocument): void {
    this.reviewDocument(doc, { decision: 'approve' });
  }

  protected startReject(doc: AdminDocument): void {
    this.rejectReason.set('');
    this.rejectNote.set('');
    this.rejectTried.set(false);
    this.rejecting.set(doc);
  }

  protected confirmReject(): void {
    const doc = this.rejecting();
    this.rejectTried.set(true);
    const reason = this.rejectReason();
    if (!doc || !reason) return;
    // "Other" means nothing to the partner without an explanation.
    if (reason === DocumentRejectionReason.Other && !this.rejectNote().trim()) return;
    this.reviewDocument(doc, {
      decision: 'reject',
      rejectionReason: reason,
      note: this.rejectNote().trim() || undefined,
    });
  }

  private reviewDocument(
    doc: AdminDocument,
    body: { decision: 'approve' | 'reject'; rejectionReason?: DocumentRejectionReason; note?: string },
  ): void {
    this.busy.set(true);
    this.api.reviewDocument(doc.id, body).subscribe({
      next: (updated) => {
        this.vcase.update((c) => ({ ...c, documents: c.documents.map((d) => (d.id === updated.id ? updated : d)) }));
        this.toasts.success(`${DOCUMENT_LABEL[doc.type]} ${body.decision === 'approve' ? 'approved' : 'rejected'}.`);
        this.busy.set(false);
        this.rejecting.set(null);
        // The partner's overall status and the history may have moved with it.
        this.vcase.load({ silent: true });
        this.counts.refresh();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }

  // ----- overall decision -----

  protected pick(decision: Decision): void {
    this.decision.set(decision);
    this.decisionTried.set(false);
  }

  protected recordDecision(): void {
    const decision = this.decision();
    this.decisionTried.set(true);
    if (!decision || this.noteMissing()) return;
    this.busy.set(true);
    this.api.decideVerification(this.id(), { decision, note: this.decisionNote().trim() || undefined }).subscribe({
      next: (updated) => {
        this.vcase.set(updated);
        this.decision.set(null);
        this.decisionNote.set('');
        this.decisionTried.set(false);
        this.busy.set(false);
        this.toasts.success('Decision recorded.');
        this.counts.refresh();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }

  // ----- listing moderation -----

  protected moderate(reason: string): void {
    const target = this.moderating();
    if (!target) return;
    this.busy.set(true);
    this.api.moderateListing(target.vehicle.id, { listingStatus: target.to, reason: reason || undefined }).subscribe({
      next: (updated) => {
        this.vcase.update((c) => ({ ...c, vehicles: c.vehicles.map((v) => (v.id === updated.id ? updated : v)) }));
        this.toasts.success(target.to === ListingStatus.Suspended ? 'Listing taken down.' : 'Listing restored.');
        this.busy.set(false);
        this.moderating.set(null);
        this.vcase.load({ silent: true });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toasts.error(error);
      },
    });
  }
}
