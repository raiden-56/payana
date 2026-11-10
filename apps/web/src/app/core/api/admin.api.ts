import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ApiRoutes,
  type AdCampaign,
  type AdCampaignInput,
  type AddTicketMessageRequest,
  type AdminBookingQuery,
  type AdminBookingRow,
  type AdminDocument,
  type AdminOverview,
  type AdminUserQuery,
  type AdminUserRow,
  type AuditLogEntry,
  type AuditLogQuery,
  type Booking,
  type CreateStaffRequest,
  type DecideVerificationRequest,
  type ModerateListingRequest,
  type Paginated,
  type PlatformSettings,
  type PlatformSettingsUpdate,
  type Region,
  type ResolveDisputeRequest,
  type Review,
  type ReviewDocumentRequest,
  type ReviewStatus,
  type StaffMember,
  type SubscriptionPlan,
  type SubscriptionPlanInput,
  type SupportTicket,
  type SuspendUserRequest,
  type TicketListQuery,
  type TicketPriority,
  type TicketStatus,
  type TourPackage,
  type TourPackageInput,
  type UpdateStaffRequest,
  type Vehicle,
  type VehicleCategory,
  type VerificationCase,
  type VerificationQueueItem,
  type VerificationQueueQuery,
} from '@payana/contracts';
import { ApiClient } from './api-client';

/**
 * Administration endpoints. Every call is permission-checked by the API; the
 * console hides what the signed-in administrator may not use, but hiding is
 * not the control.
 */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(ApiClient);

  overview(): Observable<AdminOverview> {
    return this.api.get<AdminOverview>(ApiRoutes.admin.overview);
  }

  // --- users ---
  users(query: AdminUserQuery = {}): Observable<Paginated<AdminUserRow>> {
    return this.api.get<Paginated<AdminUserRow>>(ApiRoutes.admin.users, { query });
  }
  suspendUser(id: string, body: SuspendUserRequest): Observable<AdminUserRow> {
    return this.api.post<AdminUserRow>(ApiRoutes.admin.suspendUser(id), body);
  }
  reinstateUser(id: string): Observable<AdminUserRow> {
    return this.api.post<AdminUserRow>(ApiRoutes.admin.reinstateUser(id));
  }

  // --- verification ---
  verifications(query: VerificationQueueQuery = {}): Observable<Paginated<VerificationQueueItem>> {
    return this.api.get<Paginated<VerificationQueueItem>>(ApiRoutes.admin.verifications, { query });
  }
  verification(driverProfileId: string): Observable<VerificationCase> {
    return this.api.get<VerificationCase>(ApiRoutes.admin.verification(driverProfileId));
  }
  decideVerification(driverProfileId: string, body: DecideVerificationRequest): Observable<VerificationCase> {
    return this.api.post<VerificationCase>(ApiRoutes.admin.decideVerification(driverProfileId), body);
  }
  reviewDocument(documentId: string, body: ReviewDocumentRequest): Observable<AdminDocument> {
    return this.api.post<AdminDocument>(ApiRoutes.admin.reviewDocument(documentId), body);
  }
  moderateListing(vehicleId: string, body: ModerateListingRequest): Observable<Vehicle> {
    return this.api.post<Vehicle>(ApiRoutes.admin.moderateListing(vehicleId), body);
  }

  // --- bookings ---
  bookings(query: AdminBookingQuery = {}): Observable<Paginated<AdminBookingRow>> {
    return this.api.get<Paginated<AdminBookingRow>>(ApiRoutes.admin.bookings, { query });
  }
  booking(id: string): Observable<Booking> {
    return this.api.get<Booking>(ApiRoutes.admin.booking(id));
  }
  resolveDispute(id: string, body: ResolveDisputeRequest): Observable<Booking> {
    return this.api.post<Booking>(ApiRoutes.admin.resolveDispute(id), body);
  }

  // --- catalog ---
  regions(): Observable<Region[]> {
    return this.api.get<Region[]>(ApiRoutes.admin.regions);
  }
  createRegion(body: Omit<Region, 'id'>): Observable<Region> {
    return this.api.post<Region>(ApiRoutes.admin.regions, body);
  }
  updateRegion(id: string, body: Omit<Region, 'id'>): Observable<Region> {
    return this.api.put<Region>(ApiRoutes.admin.region(id), body);
  }
  vehicleCategories(): Observable<VehicleCategory[]> {
    return this.api.get<VehicleCategory[]>(ApiRoutes.admin.vehicleCategories);
  }
  createVehicleCategory(body: Omit<VehicleCategory, 'id'>): Observable<VehicleCategory> {
    return this.api.post<VehicleCategory>(ApiRoutes.admin.vehicleCategories, body);
  }
  updateVehicleCategory(id: string, body: Omit<VehicleCategory, 'id'>): Observable<VehicleCategory> {
    return this.api.put<VehicleCategory>(ApiRoutes.admin.vehicleCategory(id), body);
  }

  // --- plans ---
  plans(): Observable<SubscriptionPlan[]> {
    return this.api.get<SubscriptionPlan[]>(ApiRoutes.admin.plans);
  }
  createPlan(body: SubscriptionPlanInput): Observable<SubscriptionPlan> {
    return this.api.post<SubscriptionPlan>(ApiRoutes.admin.plans, body);
  }
  updatePlan(id: string, body: SubscriptionPlanInput): Observable<SubscriptionPlan> {
    return this.api.put<SubscriptionPlan>(ApiRoutes.admin.plan(id), body);
  }

  // --- packages ---
  packages(): Observable<TourPackage[]> {
    return this.api.get<TourPackage[]>(ApiRoutes.admin.packages);
  }
  createPackage(body: TourPackageInput): Observable<TourPackage> {
    return this.api.post<TourPackage>(ApiRoutes.admin.packages, body);
  }
  updatePackage(id: string, body: TourPackageInput): Observable<TourPackage> {
    return this.api.put<TourPackage>(ApiRoutes.admin.package(id), body);
  }

  // --- advertisements ---
  adCampaigns(): Observable<AdCampaign[]> {
    return this.api.get<AdCampaign[]>(ApiRoutes.admin.adCampaigns);
  }
  createAdCampaign(body: AdCampaignInput): Observable<AdCampaign> {
    return this.api.post<AdCampaign>(ApiRoutes.admin.adCampaigns, body);
  }
  updateAdCampaign(id: string, body: AdCampaignInput): Observable<AdCampaign> {
    return this.api.put<AdCampaign>(ApiRoutes.admin.adCampaign(id), body);
  }

  // --- support and reviews ---
  tickets(query: TicketListQuery = {}): Observable<Paginated<SupportTicket>> {
    return this.api.get<Paginated<SupportTicket>>(ApiRoutes.admin.tickets, { query });
  }
  ticket(id: string): Observable<SupportTicket> {
    return this.api.get<SupportTicket>(ApiRoutes.admin.ticket(id));
  }
  updateTicket(id: string, body: { status?: TicketStatus; priority?: TicketPriority }): Observable<SupportTicket> {
    return this.api.patch<SupportTicket>(ApiRoutes.admin.ticket(id), body);
  }
  replyToTicket(id: string, body: AddTicketMessageRequest): Observable<SupportTicket> {
    return this.api.post<SupportTicket>(ApiRoutes.admin.ticketMessages(id), body);
  }
  moderateReview(id: string, body: { status: ReviewStatus; reason?: string }): Observable<Review> {
    return this.api.post<Review>(ApiRoutes.admin.moderateReview(id), body);
  }

  // --- settings, audit, staff ---
  settings(): Observable<PlatformSettings> {
    return this.api.get<PlatformSettings>(ApiRoutes.admin.settings);
  }
  saveSettings(body: PlatformSettingsUpdate): Observable<PlatformSettings> {
    return this.api.put<PlatformSettings>(ApiRoutes.admin.settings, body);
  }
  auditLogs(query: AuditLogQuery = {}): Observable<Paginated<AuditLogEntry>> {
    return this.api.get<Paginated<AuditLogEntry>>(ApiRoutes.admin.auditLogs, { query });
  }
  staff(): Observable<StaffMember[]> {
    return this.api.get<StaffMember[]>(ApiRoutes.admin.staff);
  }
  createStaff(body: CreateStaffRequest): Observable<StaffMember> {
    return this.api.post<StaffMember>(ApiRoutes.admin.staff, body);
  }
  updateStaff(id: string, body: UpdateStaffRequest): Observable<StaffMember> {
    return this.api.patch<StaffMember>(ApiRoutes.admin.staffMember(id), body);
  }
}
