import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ApiRoutes,
  type AddTicketMessageRequest,
  type Booking,
  type BookingListQuery,
  type CancelBookingRequest,
  type ConsentPreferences,
  type ConsentPreferencesInput,
  type CreateRideRequest,
  type CreateTicketRequest,
  type DeletionRequestInput,
  type DeletionRequestStatus,
  type EmergencyContact,
  type Me,
  type NotificationList,
  type Paginated,
  type Receipt,
  type Review,
  type RideRequest,
  type RideRequestListQuery,
  type SavedPlace,
  type SavedPlaceInput,
  type SessionInfo,
  type SubmitReviewRequest,
  type SupportTicket,
  type TicketListQuery,
  type TransitionBookingRequest,
  type UpdateMeRequest,
} from '@payana/contracts';
import { ApiClient } from './api-client';

/** The signed-in account: profile, saved places, privacy, sessions. */
@Injectable({ providedIn: 'root' })
export class MeApi {
  private readonly api = inject(ApiClient);

  update(body: UpdateMeRequest): Observable<Me> {
    return this.api.patch<Me>(ApiRoutes.me.root, body);
  }

  emergencyContact(): Observable<EmergencyContact | null> {
    return this.api.get<EmergencyContact | null>(ApiRoutes.me.emergencyContact);
  }
  saveEmergencyContact(body: EmergencyContact): Observable<EmergencyContact> {
    return this.api.put<EmergencyContact>(ApiRoutes.me.emergencyContact, body);
  }
  removeEmergencyContact(): Observable<void> {
    return this.api.delete(ApiRoutes.me.emergencyContact);
  }

  savedPlaces(): Observable<SavedPlace[]> {
    return this.api.get<SavedPlace[]>(ApiRoutes.me.savedPlaces);
  }
  addSavedPlace(body: SavedPlaceInput): Observable<SavedPlace> {
    return this.api.post<SavedPlace>(ApiRoutes.me.savedPlaces, body);
  }
  removeSavedPlace(id: string): Observable<void> {
    return this.api.delete(ApiRoutes.me.savedPlace(id));
  }

  consents(): Observable<ConsentPreferences> {
    return this.api.get<ConsentPreferences>(ApiRoutes.me.consents);
  }
  saveConsents(body: ConsentPreferencesInput): Observable<ConsentPreferences> {
    return this.api.put<ConsentPreferences>(ApiRoutes.me.consents, body);
  }

  deletionRequest(): Observable<DeletionRequestStatus> {
    return this.api.get<DeletionRequestStatus>(ApiRoutes.me.deletionRequest);
  }
  requestDeletion(body: DeletionRequestInput): Observable<DeletionRequestStatus> {
    return this.api.post<DeletionRequestStatus>(ApiRoutes.me.deletionRequest, body);
  }
  cancelDeletion(): Observable<DeletionRequestStatus> {
    return this.api.delete<DeletionRequestStatus>(ApiRoutes.me.deletionRequest);
  }

  sessions(): Observable<SessionInfo[]> {
    return this.api.get<SessionInfo[]>(ApiRoutes.auth.sessions);
  }
  revokeSession(id: string): Observable<void> {
    return this.api.delete(ApiRoutes.auth.session(id));
  }
}

/** A customer's ride requests and the quotes on them. */
@Injectable({ providedIn: 'root' })
export class RideRequestsApi {
  private readonly api = inject(ApiClient);

  create(body: CreateRideRequest, idempotencyKey: string): Observable<RideRequest> {
    return this.api.post<RideRequest>(ApiRoutes.rideRequests.root, body, { idempotent: idempotencyKey });
  }

  list(query: RideRequestListQuery = {}): Observable<Paginated<RideRequest>> {
    return this.api.get<Paginated<RideRequest>>(ApiRoutes.rideRequests.root, { query });
  }

  get(id: string): Observable<RideRequest> {
    return this.api.get<RideRequest>(ApiRoutes.rideRequests.one(id));
  }

  cancel(id: string): Observable<RideRequest> {
    return this.api.post<RideRequest>(ApiRoutes.rideRequests.cancel(id));
  }

  acceptQuote(requestId: string, quoteId: string, idempotencyKey: string): Observable<Booking> {
    return this.api.post<Booking>(
      ApiRoutes.rideRequests.acceptQuote(requestId, quoteId),
      {},
      { idempotent: idempotencyKey },
    );
  }
}

/** Bookings, as seen by either party. */
@Injectable({ providedIn: 'root' })
export class BookingsApi {
  private readonly api = inject(ApiClient);

  list(query: BookingListQuery = {}): Observable<Paginated<Booking>> {
    return this.api.get<Paginated<Booking>>(ApiRoutes.bookings.root, { query });
  }

  get(id: string): Observable<Booking> {
    return this.api.get<Booking>(ApiRoutes.bookings.one(id));
  }

  cancel(id: string, body: CancelBookingRequest): Observable<Booking> {
    return this.api.post<Booking>(ApiRoutes.bookings.cancel(id), body);
  }

  transition(id: string, body: TransitionBookingRequest): Observable<Booking> {
    return this.api.post<Booking>(ApiRoutes.bookings.transition(id), body);
  }

  receipt(id: string): Observable<Receipt> {
    return this.api.get<Receipt>(ApiRoutes.bookings.receipt(id));
  }

  review(id: string, body: SubmitReviewRequest): Observable<Review> {
    return this.api.post<Review>(ApiRoutes.bookings.review(id), body);
  }
}

@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly api = inject(ApiClient);

  list(unreadOnly = false): Observable<NotificationList> {
    return this.api.get<NotificationList>(ApiRoutes.notifications.root, {
      query: { unreadOnly: unreadOnly || undefined },
    });
  }

  markRead(id: string): Observable<void> {
    return this.api.post<void>(ApiRoutes.notifications.read(id));
  }

  markAllRead(): Observable<void> {
    return this.api.post<void>(ApiRoutes.notifications.readAll);
  }
}

@Injectable({ providedIn: 'root' })
export class SupportApi {
  private readonly api = inject(ApiClient);

  tickets(query: TicketListQuery = {}): Observable<Paginated<SupportTicket>> {
    return this.api.get<Paginated<SupportTicket>>(ApiRoutes.support.tickets, { query });
  }

  ticket(id: string): Observable<SupportTicket> {
    return this.api.get<SupportTicket>(ApiRoutes.support.ticket(id));
  }

  create(body: CreateTicketRequest): Observable<SupportTicket> {
    return this.api.post<SupportTicket>(ApiRoutes.support.tickets, body);
  }

  reply(id: string, body: AddTicketMessageRequest): Observable<SupportTicket> {
    return this.api.post<SupportTicket>(ApiRoutes.support.messages(id), body);
  }
}
