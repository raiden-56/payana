/**
 * The complete endpoint map of API v1. Paths are relative to API_PREFIX.
 *
 * Legend in the comments:  METHOD  request body -> response body  [who]
 *   [public]   no authentication
 *   [user]     any signed-in account
 *   [customer] account with the customer role
 *   [driver]   account with the driver role
 *   [perm:x]   administrator holding permission x
 *   (idem)     requires an Idempotency-Key header
 *
 * Both the API controllers and the web/mobile API client build their paths
 * from this object, so a route cannot drift between the two.
 */
export const API_PREFIX = '/api/v1';

const id = (v: string) => encodeURIComponent(v);

export const ApiRoutes = {
  // --- platform ---------------------------------------------------------------
  health: {
    /** GET -> { status: "ok" }  [public]  process is up */
    live: '/health/live',
    /** GET -> { status, checks }  [public]  database and redis reachable */
    ready: '/health/ready',
  },
  public: {
    /** GET -> PublicConfig  [public] */
    config: '/public/config',
  },

  // --- identity ---------------------------------------------------------------
  auth: {
    /** POST OtpRequest -> OtpChallenge  [public] */
    otpRequest: '/auth/otp/request',
    /** POST OtpVerifyRequest -> AuthSession  [public] */
    otpVerify: '/auth/otp/verify',
    /** POST RefreshRequest -> AuthSession  [refresh cookie or body token] */
    refresh: '/auth/refresh',
    /** POST -> 204  [user]  revokes the current session */
    logout: '/auth/logout',
    /** GET -> SessionInfo[]  [user] */
    sessions: '/auth/sessions',
    /** DELETE -> 204  [user] */
    session: (sessionId: string) => `/auth/sessions/${id(sessionId)}`,
    /** POST AdminLoginRequest -> AdminLoginResponse  [public] */
    adminLogin: '/auth/admin/login',
    /** POST AdminMfaVerifyRequest -> AuthSession  [public, needs mfaToken] */
    adminMfaVerify: '/auth/admin/mfa/verify',
  },
  me: {
    /** GET -> Me ; PATCH UpdateMeRequest -> Me  [user] */
    root: '/me',
    /** GET -> EmergencyContact | null ; PUT EmergencyContact -> EmergencyContact ; DELETE -> 204  [user] */
    emergencyContact: '/me/emergency-contact',
    /** GET -> SavedPlace[] ; POST SavedPlaceInput -> SavedPlace  [user] */
    savedPlaces: '/me/saved-places',
    /** PUT SavedPlaceInput -> SavedPlace ; DELETE -> 204  [user] */
    savedPlace: (placeId: string) => `/me/saved-places/${id(placeId)}`,
    /** GET -> ConsentPreferences ; PUT ConsentPreferencesInput -> ConsentPreferences  [user] */
    consents: '/me/consents',
    /** GET -> DeletionRequestStatus ; POST DeletionRequestInput -> DeletionRequestStatus ; DELETE -> DeletionRequestStatus  [user] */
    deletionRequest: '/me/deletion-request',
  },

  // --- catalog ----------------------------------------------------------------
  catalog: {
    /** GET -> Region[]  [public]  live and coming-soon regions */
    regions: '/regions',
    /** GET -> VehicleCategory[]  [public]  active categories */
    vehicleCategories: '/vehicle-categories',
    /** GET ?fromLat&fromLng&toLat&toLng&categoryCode -> FareEstimate  [public] */
    fareEstimate: '/fare-estimate',
    /** GET PlaceSearchQuery -> PlaceSuggestion[]  [public]  curated pickup / drop points */
    places: '/places',
  },

  // --- discovery --------------------------------------------------------------
  drivers: {
    /** GET DriverSearchQuery -> Paginated<DriverListing>  [public] */
    search: '/drivers',
    /** GET -> DriverPublicProfile  [public] */
    profile: (driverId: string) => `/drivers/${id(driverId)}`,
    /** GET PageQuery -> Paginated<Review>  [public] */
    reviews: (driverId: string) => `/drivers/${id(driverId)}/reviews`,
  },

  // --- partner self-service ---------------------------------------------------
  driver: {
    /** GET -> DriverProfile | null ; PUT UpsertDriverProfileRequest -> DriverProfile  [driver] */
    profile: '/driver/profile',
    /** POST -> DriverProfile  [driver]  submit for verification */
    submitForReview: '/driver/profile/submit',
    /** GET -> Vehicle[] ; POST UpsertVehicleRequest -> Vehicle  [driver] */
    vehicles: '/driver/vehicles',
    /** PUT UpsertVehicleRequest -> Vehicle ; DELETE -> 204  [driver, owner of vehicle] */
    vehicle: (vehicleId: string) => `/driver/vehicles/${id(vehicleId)}`,
    /** PUT UpdateRatesRequest -> Vehicle  [driver, owner of vehicle] */
    rates: '/driver/rates',
    /** GET -> DriverDocument[] ; POST SubmitDocumentRequest -> DriverDocument  [driver] */
    documents: '/driver/documents',
    /** PUT UpdateAvailabilityRequest -> DriverProfile  [driver, verified] */
    availability: '/driver/availability',
    /** POST LocationPing -> 204  [driver] */
    location: '/driver/location',
    /** GET -> VehicleAuthorization[] ; POST CreateAuthorizationRequest -> VehicleAuthorization  [driver] */
    authorizations: '/driver/authorizations',
    /** POST -> VehicleAuthorization  [driver, invitee] */
    acceptAuthorization: (authId: string) => `/driver/authorizations/${id(authId)}/accept`,
    /** POST -> VehicleAuthorization  [driver, owner or invitee] */
    revokeAuthorization: (authId: string) => `/driver/authorizations/${id(authId)}/revoke`,
    /** GET PageQuery -> Paginated<DriverRequestFeedItem>  [driver, verified] */
    requests: '/driver/requests',
    /** GET -> DriverRequestFeedItem  [driver, verified] */
    request: (requestId: string) => `/driver/requests/${id(requestId)}`,
    /** POST SubmitQuoteRequest -> Quote  [driver, verified] (idem) */
    quotes: (requestId: string) => `/driver/requests/${id(requestId)}/quotes`,
    /** POST -> Quote  [driver, author of quote] */
    withdrawQuote: (quoteId: string) => `/driver/quotes/${id(quoteId)}/withdraw`,
    /** POST -> 204  [driver]  hide the request from this driver's inbox */
    declineRequest: (requestId: string) => `/driver/requests/${id(requestId)}/decline`,
    /** GET BookingListQuery -> Paginated<Booking>  [driver] */
    bookings: '/driver/bookings',
    /** GET ?periodDays -> DriverMetrics  [driver] */
    metrics: '/driver/metrics',
    /** GET -> DriverSubscription  [driver] */
    subscription: '/driver/subscription',
    /** POST SubscriptionCheckoutRequest -> CheckoutSession  [driver] (idem) */
    subscriptionCheckout: '/driver/subscription/checkout',
    /** POST -> DriverSubscription  [driver]  stop auto-renewal */
    subscriptionCancel: '/driver/subscription/cancel',
    /** GET PageQuery -> Paginated<Invoice>  [driver] */
    invoices: '/driver/invoices',
    /** GET -> FeaturedPlacement[] ; POST PurchaseFeaturedPlacementRequest -> FeaturedPlacement  [driver] (idem) */
    featuredPlacements: '/driver/featured-placements',
    /** POST ReplyToReviewRequest -> Review  [driver, reviewed driver] */
    replyToReview: (reviewId: string) => `/driver/reviews/${id(reviewId)}/reply`,
  },
  uploads: {
    /** POST PresignUploadRequest -> PresignUploadResponse  [user] */
    presign: '/uploads/presign',
    /** PUT raw bytes -> 204  [signed URL]  local-disk adapter only */
    localPut: (token: string) => `/uploads/local/${id(token)}`,
    /** GET -> file bytes  [signed URL] */
    file: (token: string) => `/files/${id(token)}`,
  },

  // --- ride requests, quotes, bookings -----------------------------------------
  rideRequests: {
    /** GET RideRequestListQuery -> Paginated<RideRequest> ; POST CreateRideRequest -> RideRequest (idem)  [customer] */
    root: '/ride-requests',
    /** GET -> RideRequest  [customer, owner of request] */
    one: (requestId: string) => `/ride-requests/${id(requestId)}`,
    /** POST -> RideRequest  [customer, owner of request] */
    cancel: (requestId: string) => `/ride-requests/${id(requestId)}/cancel`,
    /** POST -> Booking  [customer, owner of request] (idem) */
    acceptQuote: (requestId: string, quoteId: string) =>
      `/ride-requests/${id(requestId)}/quotes/${id(quoteId)}/accept`,
  },
  bookings: {
    /** GET BookingListQuery -> Paginated<Booking>  [customer] */
    root: '/bookings',
    /** GET -> Booking  [customer or driver of the booking] */
    one: (bookingId: string) => `/bookings/${id(bookingId)}`,
    /** POST CancelBookingRequest -> Booking  [customer or driver of the booking] */
    cancel: (bookingId: string) => `/bookings/${id(bookingId)}/cancel`,
    /** POST TransitionBookingRequest -> Booking  [driver of the booking] */
    transition: (bookingId: string) => `/bookings/${id(bookingId)}/transitions`,
    /** GET -> Receipt  [customer or driver of the booking, completed only] */
    receipt: (bookingId: string) => `/bookings/${id(bookingId)}/receipt`,
    /** POST SubmitReviewRequest -> Review  [customer of the booking] */
    review: (bookingId: string) => `/bookings/${id(bookingId)}/review`,
  },

  // --- packages, plans, advertisements ------------------------------------------
  packages: {
    /** GET ?regionSlug -> TourPackage[]  [public] */
    root: '/packages',
    /** GET -> TourPackage  [public] */
    one: (slug: string) => `/packages/${id(slug)}`,
  },
  plans: {
    /** GET -> SubscriptionPlan[]  [public]  active plans */
    root: '/plans',
  },
  ads: {
    /** GET ?placement&regionSlug -> AdCreative[]  [public] */
    root: '/ads',
    /** POST -> 204  [public, rate limited] */
    impression: (campaignId: string) => `/ads/${id(campaignId)}/impression`,
    /** POST -> 204  [public, rate limited] */
    click: (campaignId: string) => `/ads/${id(campaignId)}/click`,
  },

  // --- notifications and support -------------------------------------------------
  notifications: {
    /** GET ?unreadOnly -> NotificationList  [user] */
    root: '/notifications',
    /** POST -> 204  [user] */
    read: (notificationId: string) => `/notifications/${id(notificationId)}/read`,
    /** POST -> 204  [user] */
    readAll: '/notifications/read-all',
  },
  support: {
    /** GET TicketListQuery -> Paginated<SupportTicket> ; POST CreateTicketRequest -> SupportTicket  [user] */
    tickets: '/support/tickets',
    /** GET -> SupportTicket  [user, owner of ticket] */
    ticket: (ticketId: string) => `/support/tickets/${id(ticketId)}`,
    /** POST AddTicketMessageRequest -> SupportTicket  [user, owner of ticket] */
    messages: (ticketId: string) => `/support/tickets/${id(ticketId)}/messages`,
  },

  // --- administration -------------------------------------------------------------
  admin: {
    /** GET -> AdminOverview  [perm:overview.read] */
    overview: '/admin/overview',
    /** GET AdminUserQuery -> Paginated<AdminUserRow>  [perm:users.read] */
    users: '/admin/users',
    /** POST SuspendUserRequest -> AdminUserRow  [perm:users.suspend] */
    suspendUser: (userId: string) => `/admin/users/${id(userId)}/suspend`,
    /** POST -> AdminUserRow  [perm:users.suspend] */
    reinstateUser: (userId: string) => `/admin/users/${id(userId)}/reinstate`,
    /** GET VerificationQueueQuery -> Paginated<VerificationQueueItem>  [perm:verification.read] */
    verifications: '/admin/verifications',
    /** GET -> VerificationCase  [perm:verification.read] */
    verification: (driverProfileId: string) => `/admin/verifications/${id(driverProfileId)}`,
    /** POST DecideVerificationRequest -> VerificationCase  [perm:verification.review] */
    decideVerification: (driverProfileId: string) =>
      `/admin/verifications/${id(driverProfileId)}/decision`,
    /** POST ReviewDocumentRequest -> AdminDocument  [perm:verification.review] */
    reviewDocument: (documentId: string) => `/admin/documents/${id(documentId)}/review`,
    /** POST ModerateListingRequest -> Vehicle  [perm:listings.moderate] */
    moderateListing: (vehicleId: string) => `/admin/vehicles/${id(vehicleId)}/listing`,
    /** GET AdminBookingQuery -> Paginated<AdminBookingRow>  [perm:bookings.read] */
    bookings: '/admin/bookings',
    /** GET -> Booking  [perm:bookings.read] */
    booking: (bookingId: string) => `/admin/bookings/${id(bookingId)}`,
    /** POST ResolveDisputeRequest -> Booking  [perm:bookings.resolve] */
    resolveDispute: (bookingId: string) => `/admin/bookings/${id(bookingId)}/resolve`,
    /** GET -> Region[] (all statuses) ; POST -> Region  [perm:catalog.manage] */
    regions: '/admin/regions',
    /** PUT -> Region  [perm:catalog.manage] */
    region: (regionId: string) => `/admin/regions/${id(regionId)}`,
    /** GET -> VehicleCategory[] (incl. inactive) ; POST -> VehicleCategory  [perm:catalog.manage] */
    vehicleCategories: '/admin/vehicle-categories',
    /** PUT -> VehicleCategory  [perm:catalog.manage] */
    vehicleCategory: (categoryId: string) => `/admin/vehicle-categories/${id(categoryId)}`,
    /** GET -> SubscriptionPlan[] (incl. inactive) ; POST SubscriptionPlanInput -> SubscriptionPlan  [perm:plans.manage] */
    plans: '/admin/plans',
    /** PUT SubscriptionPlanInput -> SubscriptionPlan  [perm:plans.manage] */
    plan: (planId: string) => `/admin/plans/${id(planId)}`,
    /** GET -> TourPackage[] (incl. inactive) ; POST TourPackageInput -> TourPackage  [perm:packages.manage] */
    packages: '/admin/packages',
    /** PUT TourPackageInput -> TourPackage  [perm:packages.manage] */
    package: (packageId: string) => `/admin/packages/${id(packageId)}`,
    /** GET -> AdCampaign[] ; POST AdCampaignInput -> AdCampaign  [perm:ads.manage] */
    adCampaigns: '/admin/ad-campaigns',
    /** PUT AdCampaignInput -> AdCampaign  [perm:ads.manage] */
    adCampaign: (campaignId: string) => `/admin/ad-campaigns/${id(campaignId)}`,
    /** GET TicketListQuery -> Paginated<SupportTicket>  [perm:support.manage] */
    tickets: '/admin/support/tickets',
    /** GET -> SupportTicket ; PATCH { status?, priority? } -> SupportTicket  [perm:support.manage] */
    ticket: (ticketId: string) => `/admin/support/tickets/${id(ticketId)}`,
    /** POST AddTicketMessageRequest -> SupportTicket  [perm:support.manage] */
    ticketMessages: (ticketId: string) => `/admin/support/tickets/${id(ticketId)}/messages`,
    /** POST { status: ReviewStatus, reason? } -> Review  [perm:reviews.moderate] */
    moderateReview: (reviewId: string) => `/admin/reviews/${id(reviewId)}/moderation`,
    /** GET -> PlatformSettings [perm:settings.read] ; PUT PlatformSettingsUpdate -> PlatformSettings [perm:settings.manage] */
    settings: '/admin/settings',
    /** GET AuditLogQuery -> Paginated<AuditLogEntry>  [perm:audit.read] */
    auditLogs: '/admin/audit-logs',
    /** GET -> StaffMember[] ; POST CreateStaffRequest -> StaffMember  [perm:staff.manage] */
    staff: '/admin/staff',
    /** PATCH UpdateStaffRequest -> StaffMember  [perm:staff.manage] */
    staffMember: (userId: string) => `/admin/staff/${id(userId)}`,
  },
} as const;
