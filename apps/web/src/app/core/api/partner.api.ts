import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  ApiRoutes,
  type Booking,
  type BookingListQuery,
  type CheckoutSession,
  type CreateAuthorizationRequest,
  type DriverDocument,
  type DriverMetrics,
  type DriverProfile,
  type DriverRequestFeedItem,
  type DriverSubscription,
  type FeaturedPlacement,
  type Invoice,
  type LocationPing,
  type PageQuery,
  type Paginated,
  type PresignUploadRequest,
  type PresignUploadResponse,
  type PurchaseFeaturedPlacementRequest,
  type Quote,
  type ReplyToReviewRequest,
  type Review,
  type SubmitDocumentRequest,
  type SubmitQuoteRequest,
  type UpdateAvailabilityRequest,
  type UpdateRatesRequest,
  type UploadPurpose,
  type UpsertDriverProfileRequest,
  type UpsertVehicleRequest,
  type Vehicle,
  type VehicleAuthorization,
} from '@payana/contracts';
import { ApiClient } from './api-client';

/** Everything a driver / vehicle owner does for themselves. Requires the driver role. */
@Injectable({ providedIn: 'root' })
export class PartnerApi {
  private readonly api = inject(ApiClient);

  // --- profile and onboarding ---
  profile(): Observable<DriverProfile | null> {
    return this.api.get<DriverProfile | null>(ApiRoutes.driver.profile);
  }
  saveProfile(body: UpsertDriverProfileRequest): Observable<DriverProfile> {
    return this.api.put<DriverProfile>(ApiRoutes.driver.profile, body);
  }
  submitForReview(): Observable<DriverProfile> {
    return this.api.post<DriverProfile>(ApiRoutes.driver.submitForReview);
  }

  // --- vehicles ---
  vehicles(): Observable<Vehicle[]> {
    return this.api.get<Vehicle[]>(ApiRoutes.driver.vehicles);
  }
  addVehicle(body: UpsertVehicleRequest): Observable<Vehicle> {
    return this.api.post<Vehicle>(ApiRoutes.driver.vehicles, body);
  }
  updateVehicle(id: string, body: UpsertVehicleRequest): Observable<Vehicle> {
    return this.api.put<Vehicle>(ApiRoutes.driver.vehicle(id), body);
  }
  removeVehicle(id: string): Observable<void> {
    return this.api.delete(ApiRoutes.driver.vehicle(id));
  }
  saveRates(body: UpdateRatesRequest): Observable<Vehicle> {
    return this.api.put<Vehicle>(ApiRoutes.driver.rates, body);
  }

  // --- documents ---
  documents(): Observable<DriverDocument[]> {
    return this.api.get<DriverDocument[]>(ApiRoutes.driver.documents);
  }
  submitDocument(body: SubmitDocumentRequest): Observable<DriverDocument> {
    return this.api.post<DriverDocument>(ApiRoutes.driver.documents, body);
  }

  // --- availability and location ---
  setAvailability(body: UpdateAvailabilityRequest): Observable<DriverProfile> {
    return this.api.put<DriverProfile>(ApiRoutes.driver.availability, body);
  }
  sendLocation(body: LocationPing): Observable<void> {
    return this.api.post<void>(ApiRoutes.driver.location, body);
  }

  // --- owner <-> driver authorisations ---
  authorizations(): Observable<VehicleAuthorization[]> {
    return this.api.get<VehicleAuthorization[]>(ApiRoutes.driver.authorizations);
  }
  createAuthorization(body: CreateAuthorizationRequest): Observable<VehicleAuthorization> {
    return this.api.post<VehicleAuthorization>(ApiRoutes.driver.authorizations, body);
  }
  acceptAuthorization(id: string): Observable<VehicleAuthorization> {
    return this.api.post<VehicleAuthorization>(ApiRoutes.driver.acceptAuthorization(id));
  }
  revokeAuthorization(id: string): Observable<VehicleAuthorization> {
    return this.api.post<VehicleAuthorization>(ApiRoutes.driver.revokeAuthorization(id));
  }

  // --- requests and quotes ---
  requests(page: PageQuery = {}): Observable<Paginated<DriverRequestFeedItem>> {
    return this.api.get<Paginated<DriverRequestFeedItem>>(ApiRoutes.driver.requests, { query: page });
  }
  request(id: string): Observable<DriverRequestFeedItem> {
    return this.api.get<DriverRequestFeedItem>(ApiRoutes.driver.request(id));
  }
  submitQuote(requestId: string, body: SubmitQuoteRequest, idempotencyKey: string): Observable<Quote> {
    return this.api.post<Quote>(ApiRoutes.driver.quotes(requestId), body, { idempotent: idempotencyKey });
  }
  withdrawQuote(quoteId: string): Observable<Quote> {
    return this.api.post<Quote>(ApiRoutes.driver.withdrawQuote(quoteId));
  }
  declineRequest(requestId: string): Observable<void> {
    return this.api.post<void>(ApiRoutes.driver.declineRequest(requestId));
  }

  // --- bookings and performance ---
  bookings(query: BookingListQuery = {}): Observable<Paginated<Booking>> {
    return this.api.get<Paginated<Booking>>(ApiRoutes.driver.bookings, { query });
  }
  metrics(periodDays = 30): Observable<DriverMetrics> {
    return this.api.get<DriverMetrics>(ApiRoutes.driver.metrics, { query: { periodDays } });
  }
  replyToReview(reviewId: string, body: ReplyToReviewRequest): Observable<Review> {
    return this.api.post<Review>(ApiRoutes.driver.replyToReview(reviewId), body);
  }

  // --- plan, invoices, featured placements ---
  subscription(): Observable<DriverSubscription> {
    return this.api.get<DriverSubscription>(ApiRoutes.driver.subscription);
  }
  checkout(planId: string, idempotencyKey: string): Observable<CheckoutSession> {
    return this.api.post<CheckoutSession>(
      ApiRoutes.driver.subscriptionCheckout,
      { planId },
      { idempotent: idempotencyKey },
    );
  }
  cancelSubscription(): Observable<DriverSubscription> {
    return this.api.post<DriverSubscription>(ApiRoutes.driver.subscriptionCancel);
  }
  invoices(page: PageQuery = {}): Observable<Paginated<Invoice>> {
    return this.api.get<Paginated<Invoice>>(ApiRoutes.driver.invoices, { query: page });
  }
  featuredPlacements(): Observable<FeaturedPlacement[]> {
    return this.api.get<FeaturedPlacement[]>(ApiRoutes.driver.featuredPlacements);
  }
  purchaseFeaturedPlacement(
    body: PurchaseFeaturedPlacementRequest,
    idempotencyKey: string,
  ): Observable<FeaturedPlacement> {
    return this.api.post<FeaturedPlacement>(ApiRoutes.driver.featuredPlacements, body, {
      idempotent: idempotencyKey,
    });
  }
}

/** Two-step file upload: ask the API for a signed URL, then PUT the bytes to it. */
@Injectable({ providedIn: 'root' })
export class UploadsApi {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);

  /** Uploads a file and resolves to the `fileKey` to attach to a document or vehicle. */
  upload(file: File, purpose: UploadPurpose): Observable<string> {
    const body: PresignUploadRequest = {
      purpose,
      contentType: file.type as PresignUploadRequest['contentType'],
      sizeBytes: file.size,
    };
    return this.api.post<PresignUploadResponse>(ApiRoutes.uploads.presign, body).pipe(
      switchMap((signed) =>
        this.http
          .put(signed.uploadUrl, file, { headers: signed.headers, responseType: 'text' })
          .pipe(map(() => signed.fileKey)),
      ),
    );
  }
}
