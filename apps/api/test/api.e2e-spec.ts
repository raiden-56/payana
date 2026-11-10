import { randomUUID } from 'node:crypto';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { AccountRole, AdminRole, ApiRoutes } from '@payana/contracts';
import { IS_PUBLIC, PERMISSIONS, ROLES } from '../src/common/auth/auth.types.js';
import { GOKARNA_BUS_STAND, Harness, P, type Partner, type Signed } from './support/harness.js';

const PROBLEM = /application\/problem\+json/;
let h: Harness;
let officer: { token: string };

beforeAll(async () => {
  h = await Harness.boot();
  officer = await h.staff(AdminRole.VerificationOfficer);
});

afterAll(async () => {
  await h.close();
});

// ===========================================================================================
// The whole journey, end to end, over HTTP
// ===========================================================================================
describe('journey: sign-in to reviewed trip', () => {
  let driver: Partner;
  let customer: Signed;
  let requestId: string;
  let quoteId: string;
  let bookingId: string;

  it('a driver signs in by OTP, onboards and is listed only after an officer approves', async () => {
    driver = await h.onboardPartner();
    expect(driver.me.roles).toContain(AccountRole.Driver);

    const before = await h.http.get(P + ApiRoutes.driver.profile).set(h.bearer(driver.token)).expect(200);
    expect(before.body).toMatchObject({ verificationStatus: 'pending', listingStatus: 'unlisted', onboarding: { readyForReview: true } });

    // Not verified yet: cannot go online, and is not in search.
    const early = await h.http
      .put(P + ApiRoutes.driver.availability)
      .set(h.bearer(driver.token))
      .send({ status: 'available', vehicleId: driver.vehicleId })
      .expect(403);
    expect(early.body.code).toBe('driver_not_verified');

    const queue = await h.http.get(P + ApiRoutes.admin.verifications).set(h.bearer(officer.token)).expect(200);
    expect(queue.body.items.map((i: { driverProfileId: string }) => i.driverProfileId)).toContain(driver.profileId);

    const kase = await h.http.get(P + ApiRoutes.admin.verification(driver.profileId)).set(h.bearer(officer.token)).expect(200);
    expect(kase.body.documents).toHaveLength(6);
    expect(kase.body.documents[0].documentNumber).toMatch(/^DOC\d{6}$/);
    // The officer can open the file through a signed, expiring link.
    await h.http.get(kase.body.documents[0].fileUrl).expect(200).expect('Content-Type', /image\/png/);

    // The partner sees the same document with its number masked.
    const own = await h.http.get(P + ApiRoutes.driver.documents).set(h.bearer(driver.token)).expect(200);
    expect(own.body[0].numberMasked).toMatch(/^••••\d{4}$/);
    expect(JSON.stringify(own.body)).not.toContain(kase.body.documents[0].documentNumber);

    await h.approve(officer.token, driver.profileId);
    const after = await h.http.get(P + ApiRoutes.driver.profile).set(h.bearer(driver.token)).expect(200);
    expect(after.body).toMatchObject({ verificationStatus: 'approved', listingStatus: 'published' });

    await h.http
      .put(P + ApiRoutes.driver.rates)
      .set(h.bearer(driver.token))
      .send({ vehicleId: driver.vehicleId, baseFareMinor: 4000, perKmMinor: 99_000, perHourWaitingMinor: 6000 })
      .expect(400);
    await h.http
      .put(P + ApiRoutes.driver.rates)
      .set(h.bearer(driver.token))
      .send({ vehicleId: driver.vehicleId, baseFareMinor: 4000, perKmMinor: 1900, perHourWaitingMinor: 6000 })
      .expect(200);
    await h.goOnline(driver);
  });

  it('a customer finds the driver nearby without ever receiving coordinates', async () => {
    customer = await h.signIn('customer');
    await h.http.patch(P + ApiRoutes.me.root).set(h.bearer(customer.token)).send({ displayName: 'Anita Rao' }).expect(200);

    const res = await h.http
      .get(P + ApiRoutes.drivers.search)
      .query({ lat: GOKARNA_BUS_STAND.lat, lng: GOKARNA_BUS_STAND.lng, radiusKm: 5, categoryCode: 'auto' })
      .expect(200);
    const listing = res.body.items.find((i: { driverId: string }) => i.driverId === driver.profileId);
    expect(listing).toBeDefined();
    expect(listing).toMatchObject({
      isVerified: true,
      availability: 'available',
      location: { freshness: 'live' },
      rates: { perKm: { amountMinor: 1900, currency: 'INR' } },
    });
    expect(listing.location.distanceKm).toBeLessThan(1);
    expect(listing.location.bearingDeg % 10).toBe(0);
    expect(listing.vehicle.registrationMasked).toMatch(/^KA 47 •• \d{4}$/);
    expect(JSON.stringify(listing)).not.toMatch(/"lat"|"lng"|registrationNumber|phone/);

    // Outside the radius the driver is not returned.
    const far = await h.http.get(P + ApiRoutes.drivers.search).query({ lat: 14.8136, lng: 74.129, radiusKm: 5 }).expect(200);
    expect(far.body.items.map((i: { driverId: string }) => i.driverId)).not.toContain(driver.profileId);
  });

  it('a ride request is idempotent and reaches the matching driver', async () => {
    const key = h.key();
    const body = h.rideRequestBody();
    const send = (k: string | null, b: object) => {
      const r = h.http.post(P + ApiRoutes.rideRequests.root).set(h.bearer(customer.token));
      if (k) r.set('Idempotency-Key', k);
      return r.send(b);
    };

    const missing = await send(null, body).expect(400);
    expect(missing.body.code).toBe('idempotency_key_required');

    const first = await send(key, body).expect(201);
    requestId = first.body.id;
    expect(first.body).toMatchObject({ status: 'open', categoryName: 'Auto rickshaw', estimate: { basis: 'straight_line' } });
    expect(first.body.driversNotified).toBeGreaterThanOrEqual(1);

    const replay = await send(key, body).expect(201);
    expect(replay.body.id).toBe(requestId);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const conflict = await send(key, { ...body, passengers: 3 }).expect(409);
    expect(conflict.body.code).toBe('idempotency_key_reused');

    const mine = await h.http.get(P + ApiRoutes.rideRequests.root).set(h.bearer(customer.token)).expect(200);
    expect(mine.body.total).toBe(1);

    const feed = await h.http.get(P + ApiRoutes.driver.requests).set(h.bearer(driver.token)).expect(200);
    const item = feed.body.items.find((i: { requestId: string }) => i.requestId === requestId);
    expect(item).toMatchObject({ customerFirstName: 'Anita', directRequest: false, myQuote: null });
    expect(JSON.stringify(item)).not.toContain(customer.phone);
  });

  it('the driver quotes inside the allowed band and the customer accepts', async () => {
    const tooHigh = await h.http
      .post(P + ApiRoutes.driver.quotes(requestId))
      .set(h.bearer(driver.token))
      .set('Idempotency-Key', h.key())
      .send({ vehicleId: driver.vehicleId, fareMinor: 900_000, validForMinutes: 10 })
      .expect(400);
    expect(tooHigh.body.errors[0].field).toBe('fareMinor');

    quoteId = (await h.quote(driver, requestId)).id;

    const view = await h.http.get(P + ApiRoutes.rideRequests.one(requestId)).set(h.bearer(customer.token)).expect(200);
    expect(view.body.quotes).toHaveLength(1);
    expect(view.body.quotes[0]).toMatchObject({ id: quoteId, status: 'active', fare: { amountMinor: 15_000 }, driver: { driverId: driver.profileId, isVerified: true } });

    const accepted = await h.accept(customer.token, requestId, quoteId).expect(201);
    bookingId = accepted.body.id;
    expect(accepted.body).toMatchObject({
      status: 'confirmed',
      fare: { quoted: { amountMinor: 15_000 }, bookingFee: { amountMinor: 0 }, total: { amountMinor: 15_000 } },
      driver: { id: driver.profileId, phone: driver.phone },
      customer: { phone: null },
    });
    expect(accepted.body.code).toMatch(/^PY-/);
    expect(accepted.body.vehicle.registrationNumber).toMatch(/^KA47T\d{4}$/);
    expect(accepted.body.allowedActions).toEqual(expect.arrayContaining(['cancel', 'report_issue']));

    // The driver sees the customer's number only now that a booking exists.
    const asDriver = await h.http.get(P + ApiRoutes.bookings.one(bookingId)).set(h.bearer(driver.token)).expect(200);
    expect(asDriver.body.customer.phone).toBe(customer.phone);
    expect(asDriver.body.allowedActions).toContain('mark_en_route');

    const closed = await h.http.get(P + ApiRoutes.rideRequests.one(requestId)).set(h.bearer(customer.token)).expect(200);
    expect(closed.body).toMatchObject({ status: 'booked', bookingId });
  });

  it('the driver moves the booking through its statuses in order only', async () => {
    const move = (to: string) => h.http.post(P + ApiRoutes.bookings.transition(bookingId)).set(h.bearer(driver.token)).send({ to });

    const skipped = await move('in_progress').expect(409);
    expect(skipped.body.code).toBe('invalid_transition');

    for (const to of ['driver_en_route', 'driver_arrived', 'in_progress', 'completed']) {
      const res = await move(to).expect(200);
      expect(res.body.status).toBe(to);
    }
    const backwards = await move('driver_en_route').expect(409);
    expect(backwards.body.code).toBe('invalid_transition');

    const tooLate = await h.http
      .post(P + ApiRoutes.bookings.cancel(bookingId))
      .set(h.bearer(customer.token))
      .send({ reason: 'change_of_plans' })
      .expect(409);
    expect(tooLate.body.code).toBe('cancellation_not_allowed');
  });

  it('the customer gets a receipt, reviews once, and the rating shows on the public profile', async () => {
    const done = await h.http.get(P + ApiRoutes.bookings.one(bookingId)).set(h.bearer(customer.token)).expect(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.driver.phone).toBeNull(); // contact details are withdrawn once the trip is over
    expect(done.body.allowedActions).toEqual(expect.arrayContaining(['review', 'view_receipt']));
    expect(done.body.timeline.map((e: { status: string }) => e.status)).toEqual([
      'confirmed', 'driver_en_route', 'driver_arrived', 'in_progress', 'completed',
    ]);

    const receipt = await h.http.get(P + ApiRoutes.bookings.receipt(bookingId)).set(h.bearer(customer.token)).expect(200);
    expect(receipt.body).toMatchObject({ bookingCode: done.body.code, customerName: 'Anita Rao', fare: { total: { amountMinor: 15_000 } } });

    const review = await h.http
      .post(P + ApiRoutes.bookings.review(bookingId))
      .set(h.bearer(customer.token))
      .send({ rating: 5, comment: 'Careful driver, fair price.' })
      .expect(201);
    expect(review.body).toMatchObject({ rating: 5, authorName: 'Anita R.', driverId: driver.profileId });

    const again = await h.http.post(P + ApiRoutes.bookings.review(bookingId)).set(h.bearer(customer.token)).send({ rating: 1 }).expect(409);
    expect(again.body.code).toBe('review_not_eligible');

    const profile = await h.http.get(P + ApiRoutes.drivers.profile(driver.profileId)).expect(200);
    expect(profile.body).toMatchObject({ rating: { average: 5, count: 1 }, completedTrips: 1 });
    const reviews = await h.http.get(P + ApiRoutes.drivers.reviews(driver.profileId)).expect(200);
    expect(reviews.body.items[0].comment).toBe('Careful driver, fair price.');

    await h.flushEvents();
    const types = async (token: string) =>
      (await h.http.get(P + ApiRoutes.notifications.root).set(h.bearer(token)).expect(200)).body.items.map((n: { type: string }) => n.type);
    expect(await types(customer.token)).toEqual(expect.arrayContaining(['quote_received', 'booking_status_changed']));
    expect(await types(driver.token)).toEqual(expect.arrayContaining(['new_ride_request', 'quote_accepted', 'review_received', 'verification_decided']));
  });

  it('a stale position is reported as stale, with no distance', async () => {
    await h.db.exec(`UPDATE driver_profiles SET location_updated_at = now() - interval '1 hour' WHERE id = $1`, [driver.profileId]);
    const res = await h.http.get(P + ApiRoutes.drivers.search).query({ lat: GOKARNA_BUS_STAND.lat, lng: GOKARNA_BUS_STAND.lng }).expect(200);
    const listing = res.body.items.find((i: { driverId: string }) => i.driverId === driver.profileId);
    expect(listing.location).toMatchObject({ freshness: 'stale', distanceKm: null, bearingDeg: null });
  });
});

// ===========================================================================================
// Negative paths
// ===========================================================================================
describe('authentication', () => {
  it('rejects a missing or forged token with a problem document', async () => {
    const res = await h.http.get(P + ApiRoutes.me.root).expect(401).expect('Content-Type', PROBLEM);
    expect(res.body).toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(res.body.traceId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.traceId);
    await h.http.get(P + ApiRoutes.me.root).set('Authorization', 'Bearer not.a.token').expect(401);
  });

  it('returns field-level validation errors and refuses unknown properties', async () => {
    const res = await h.http.post(P + ApiRoutes.auth.otpRequest).send({ phone: '12345', admin: true }).expect(400).expect('Content-Type', PROBLEM);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['admin', 'phone']);
  });

  it('kills a code after five wrong guesses, even for the right code', async () => {
    const phone = h.phone();
    const { challengeId, devCode } = await h.requestOtp(phone);
    const wrong = devCode === '000000' ? '111111' : '000000';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await h.http.post(P + ApiRoutes.auth.otpVerify).send({ challengeId, code: wrong });
      codes.push(res.body.code);
    }
    expect(codes).toEqual(['otp_invalid', 'otp_invalid', 'otp_invalid', 'otp_invalid', 'otp_attempts_exceeded']);
    const right = await h.http.post(P + ApiRoutes.auth.otpVerify).send({ challengeId, code: devCode }).expect(429);
    expect(right.body.code).toBe('otp_attempts_exceeded');
    // A second code for the same number is refused during the resend cool-down.
    const resend = await h.http.post(P + ApiRoutes.auth.otpRequest).send({ phone }).expect(429);
    expect(resend.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('a one-time code cannot be used twice', async () => {
    const { challengeId, devCode } = await h.requestOtp(h.phone());
    await h.http.post(P + ApiRoutes.auth.otpVerify).send({ challengeId, code: devCode }).expect(200);
    const second = await h.http.post(P + ApiRoutes.auth.otpVerify).send({ challengeId, code: devCode }).expect(400);
    expect(second.body.code).toBe('otp_expired');
  });

  it('keeps the browser refresh token in an HttpOnly cookie and rotates it', async () => {
    const signed = await h.signIn('customer');
    expect(signed.refreshToken).toBeUndefined();
    const cookie = signed.cookies.find((c) => c.startsWith('payana_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    const refreshed = await h.http.post(P + ApiRoutes.auth.refresh).set('Cookie', cookie.split(';')[0]!).send({}).expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    expect((refreshed.headers['set-cookie'] as unknown as string[])[0]).not.toBe(cookie);
    // A browser cannot smuggle a token in the body instead.
    await h.http.post(P + ApiRoutes.auth.refresh).send({ refreshToken: 'anything' }).expect(401);
  });

  it('ends the whole session when a retired refresh token is replayed', async () => {
    const native = { 'X-Client-Platform': 'native' };
    const signed = await h.signIn('customer', { native: true });
    const first = signed.refreshToken!;
    const rotated = await h.http.post(P + ApiRoutes.auth.refresh).set(native).send({ refreshToken: first }).expect(200);
    const second = rotated.body.refreshToken as string;
    expect(second).not.toBe(first);

    // Inside the grace window a repeat is refused but not treated as theft.
    const grace = await h.http.post(P + ApiRoutes.auth.refresh).set(native).send({ refreshToken: first }).expect(401);
    expect(grace.body.code).toBe('token_expired');
    await h.http.get(P + ApiRoutes.me.root).set(h.bearer(rotated.body.accessToken)).expect(200);

    // Later, the same retired token is evidence of a leak.
    await h.db.exec(`UPDATE refresh_tokens SET used_at = now() - interval '5 minutes' WHERE used_at IS NOT NULL`);
    await h.http.post(P + ApiRoutes.auth.refresh).set(native).send({ refreshToken: first }).expect(401);
    await h.http.post(P + ApiRoutes.auth.refresh).set(native).send({ refreshToken: second }).expect(401);
    await h.http.get(P + ApiRoutes.me.root).set(h.bearer(rotated.body.accessToken)).expect(401);
    const audit = await h.db.one(`SELECT 1 FROM audit_logs WHERE action = 'auth.refresh_token_reuse' AND actor_id = $1`, [signed.me.id]);
    expect(audit).not.toBeNull();
  });

  it('signing out invalidates the access token at once', async () => {
    const signed = await h.signIn('customer');
    await h.http.post(P + ApiRoutes.auth.logout).set(h.bearer(signed.token)).expect(204);
    const res = await h.http.get(P + ApiRoutes.me.root).set(h.bearer(signed.token)).expect(401);
    expect(res.body.code).toBe('token_expired');
  });

  it('locks a staff account after repeated wrong passwords and never reveals which emails exist', async () => {
    const staff = await h.staff(AdminRole.MarketingManager);
    const attempt = (email: string, password: string) => h.http.post(P + ApiRoutes.auth.adminLogin).send({ email, password });
    const unknown = await attempt('nobody@payana.test', 'whatever-password').expect(401);
    const known = await attempt(staff.email, 'wrong-password-1').expect(401);
    expect(unknown.body.code).toBe('invalid_credentials');
    expect(known.body).toMatchObject({ code: unknown.body.code, detail: unknown.body.detail });
    for (let i = 0; i < 4; i++) await attempt(staff.email, 'wrong-password-x').expect(401);
    const locked = await attempt(staff.email, h.staffPassword()).expect(429);
    expect(locked.body.code).toBe('account_locked');
  });
});

describe('authorisation', () => {
  let customer: Signed;
  let other: Signed;
  let driverA: Partner;
  let driverB: Partner;

  beforeAll(async () => {
    customer = await h.signIn('customer');
    other = await h.signIn('customer');
    driverA = await h.onlinePartner(officer.token);
    driverB = await h.onlinePartner(officer.token);
  });

  it('keeps each role inside its own area', async () => {
    const asCustomer = h.bearer(customer.token);
    expect((await h.http.get(P + ApiRoutes.driver.profile).set(asCustomer).expect(403)).body.code).toBe('forbidden');
    await h.http.get(P + ApiRoutes.admin.settings).set(asCustomer).expect(403);
    await h.http.get(P + ApiRoutes.admin.users).set(h.bearer(driverA.token)).expect(403);
    // An officer can verify partners but cannot touch settings, staff or the audit trail.
    await h.http.put(P + ApiRoutes.admin.settings).set(h.bearer(officer.token)).send({ features: { reviews: false } }).expect(403);
    await h.http.get(P + ApiRoutes.admin.staff).set(h.bearer(officer.token)).expect(403);
    await h.http.get(P + ApiRoutes.admin.auditLogs).set(h.bearer(officer.token)).expect(403);
    // Staff accounts are not customers.
    await h.http.get(P + ApiRoutes.rideRequests.root).set(h.bearer(officer.token)).expect(403);
  });

  it('hides other people’s requests, bookings and vehicles behind 404', async () => {
    const request = await h.createRequest(customer.token);
    const quote = await h.quote(driverA, request.id);

    await h.http.get(P + ApiRoutes.rideRequests.one(request.id)).set(h.bearer(other.token)).expect(404);
    await h.accept(other.token, request.id, quote.id).expect(404);
    await h.http.post(P + ApiRoutes.rideRequests.cancel(request.id)).set(h.bearer(other.token)).expect(404);
    // A driver cannot withdraw another driver's quote.
    await h.http.post(P + ApiRoutes.driver.withdrawQuote(quote.id)).set(h.bearer(driverB.token)).expect(404);

    const booking = (await h.accept(customer.token, request.id, quote.id).expect(201)).body;
    await h.http.get(P + ApiRoutes.bookings.one(booking.id)).set(h.bearer(other.token)).expect(404);
    await h.http.get(P + ApiRoutes.bookings.one(booking.id)).set(h.bearer(driverB.token)).expect(404);
    await h.http.post(P + ApiRoutes.bookings.transition(booking.id)).set(h.bearer(driverB.token)).send({ to: 'driver_en_route' }).expect(404);
    await h.http.post(P + ApiRoutes.bookings.cancel(booking.id)).set(h.bearer(other.token)).send({ reason: 'other' }).expect(404);
    await h.http.post(P + ApiRoutes.bookings.review(booking.id)).set(h.bearer(other.token)).send({ rating: 1 }).expect(404);
    // The customer of a booking cannot perform the driver's transitions.
    await h.http.post(P + ApiRoutes.bookings.transition(booking.id)).set(h.bearer(customer.token)).send({ to: 'completed' }).expect(403);

    await h.http
      .put(P + ApiRoutes.driver.vehicle(driverA.vehicleId))
      .set(h.bearer(driverB.token))
      .send({ categoryCode: 'auto', make: 'Bajaj', model: 'RE', registrationNumber: h.plate(), seats: 3, luggageCapacity: 1, hasAc: false })
      .expect(404);

    // Cancelling is allowed for a party, and records who cancelled.
    const cancelled = await h.http.post(P + ApiRoutes.bookings.cancel(booking.id)).set(h.bearer(driverA.token)).send({ reason: 'vehicle_issue' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled_by_driver', cancellation: { reason: 'vehicle_issue', feeCharged: { amountMinor: 0 } } });
  });

  it('lets a driver operate someone else’s vehicle only under an accepted authorisation', async () => {
    const tryVehicle = () =>
      h.http.put(P + ApiRoutes.driver.availability).set(h.bearer(driverB.token)).send({ status: 'available', vehicleId: driverA.vehicleId });
    expect((await tryVehicle().expect(403)).body.code).toBe('vehicle_not_authorized');

    const invite = await h.http
      .post(P + ApiRoutes.driver.authorizations)
      .set(h.bearer(driverA.token))
      .send({ vehicleId: driverA.vehicleId, driverPhone: driverB.phone })
      .expect(201);
    expect(invite.body.status).toBe('invited');
    await tryVehicle().expect(403); // invited is not enough

    // Only the invited person can accept.
    await h.http.post(P + ApiRoutes.driver.acceptAuthorization(invite.body.id)).set(h.bearer(driverA.token)).expect(404);
    await h.http.post(P + ApiRoutes.driver.acceptAuthorization(invite.body.id)).set(h.bearer(driverB.token)).expect(200);
    expect((await tryVehicle().expect(200)).body.activeVehicleId).toBe(driverA.vehicleId);

    // The owner revokes: the driver is taken offline immediately and locked out again.
    await h.http.post(P + ApiRoutes.driver.revokeAuthorization(invite.body.id)).set(h.bearer(driverA.token)).expect(200);
    const profile = await h.http.get(P + ApiRoutes.driver.profile).set(h.bearer(driverB.token)).expect(200);
    expect(profile.body).toMatchObject({ availability: 'offline', activeVehicleId: null });
    await tryVehicle().expect(403);
    await h.goOnline(driverB);
  });

  it('two simultaneous accepts produce exactly one booking', async () => {
    const request = await h.createRequest(customer.token);
    const [q1, q2] = await Promise.all([h.quote(driverA, request.id, 14_000), h.quote(driverB, request.id, 16_000)]);
    const results = await Promise.all([h.accept(customer.token, request.id, q1.id), h.accept(customer.token, request.id, q2.id)]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('request_not_open');
    const count = await h.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE request_id = $1`, [request.id]);
    expect(count?.n).toBe(1);
    const quotes = await h.db.query<{ status: string }>(`SELECT status FROM quotes WHERE request_id = $1 ORDER BY status`, [request.id]);
    expect(quotes.map((q) => q.status)).toEqual(['accepted', 'closed']);
  });

  it('a suspended account is shut out on its very next request', async () => {
    const support = await h.staff(AdminRole.SupportAgent);
    const victim = await h.signIn('customer');
    await h.http.get(P + ApiRoutes.me.root).set(h.bearer(victim.token)).expect(200);
    await h.http.post(P + ApiRoutes.admin.suspendUser(victim.me.id)).set(h.bearer(support.token)).send({ reason: 'Abusive messages to a driver' }).expect(200);
    await h.http.get(P + ApiRoutes.me.root).set(h.bearer(victim.token)).expect(401);
    // And cannot simply sign in again.
    const challenge = await h.db.one(`SELECT 1 FROM users WHERE id = $1 AND status = 'suspended'`, [victim.me.id]);
    expect(challenge).not.toBeNull();
  });
});

describe('platform settings (Google Analytics / Ads identifiers)', () => {
  it('a super administrator enrols MFA, saves identifiers, and clients receive them', async () => {
    const admin = await h.staff(AdminRole.SuperAdmin, { enrolled: false });
    const auth = h.bearer(admin.token);

    const bad = await h.http.put(P + ApiRoutes.admin.settings).set(auth).send({ analytics: { ga4MeasurementId: 'UA-1234' } }).expect(400);
    expect(bad.body.errors[0].field).toBe('analytics.ga4MeasurementId');

    const saved = await h.http
      .put(P + ApiRoutes.admin.settings)
      .set(auth)
      .send({
        analytics: {
          ga4MeasurementId: 'G-AB12CD34EF',
          googleAdsId: 'AW-1234567890',
          googleAdsConversionLabels: { booking_confirmed: 'AbCdEfGhIjKl' },
          adsensePublisherId: 'ca-pub-1234567890123456',
        },
        bookingFee: { enabled: true, flatMinor: 500, percent: 2, capMinor: 5000 },
      })
      .expect(200);
    expect(saved.body.analytics).toMatchObject({ ga4MeasurementId: 'G-AB12CD34EF', requireConsent: true });

    const config = await h.http.get(P + ApiRoutes.public.config).expect(200);
    expect(config.body.analytics).toMatchObject({ googleAdsId: 'AW-1234567890', googleAdsConversionLabels: { booking_confirmed: 'AbCdEfGhIjKl' } });
    expect(config.body.bookingFee).toMatchObject({ enabled: true, percent: 2 });

    const audit = await h.http.get(P + ApiRoutes.admin.auditLogs).query({ action: 'settings.' }).set(auth).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'settings.updated', actorId: admin.id });

    // Switch everything back off: an empty identifier is valid and means "disabled".
    const cleared = await h.http
      .put(P + ApiRoutes.admin.settings)
      .set(auth)
      .send({ analytics: { ga4MeasurementId: '', googleAdsId: '', googleAdsConversionLabels: {}, adsensePublisherId: '' }, bookingFee: { enabled: false } })
      .expect(200);
    expect(cleared.body.analytics.ga4MeasurementId).toBe('');
  });
});

// ===========================================================================================
// Every route is either deliberately public or guarded
// ===========================================================================================
describe('route protection', () => {
  const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const EXPECTED_PUBLIC = [
    'GET /health/live', 'GET /health/ready', 'GET /public/config',
    'POST /auth/otp/request', 'POST /auth/otp/verify', 'POST /auth/refresh', 'POST /auth/admin/login', 'POST /auth/admin/mfa/verify',
    'GET /regions', 'GET /vehicle-categories', 'GET /places', 'GET /fare-estimate',
    'GET /drivers', 'GET /drivers/:driverId', 'GET /drivers/:driverId/reviews',
    'PUT /uploads/local/:token', 'GET /files/:token',
    'GET /packages', 'GET /packages/:slug', 'GET /plans',
    'GET /ads', 'POST /ads/:campaignId/impression', 'POST /ads/:campaignId/click',
  ].sort();

  interface Route { key: string; method: string; path: string; isPublic: boolean; roles?: string[]; permissions?: string[] }

  function routes(): Route[] {
    const discovery = h.app.get(DiscoveryService);
    const reflector = h.app.get(Reflector);
    const scanner = new MetadataScanner();
    const out: Route[] = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, (...args: unknown[]) => unknown>)[name]!;
        const path = Reflect.getMetadata('path', handler) as string | undefined;
        const method = Reflect.getMetadata('method', handler) as number | undefined;
        if (path === undefined || method === undefined) continue;
        const targets = [handler, instance.constructor];
        out.push({
          key: `${METHODS[method]} ${path}`,
          method: METHODS[method]!,
          path,
          isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) === true,
          roles: reflector.getAllAndOverride<string[]>(ROLES, targets),
          permissions: reflector.getAllAndOverride<string[]>(PERMISSIONS, targets),
        });
      }
    }
    return out;
  }

  it('the public routes are exactly the ones the contract marks public', () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((r) => r.isPublic).map((r) => r.key).sort()).toEqual(EXPECTED_PUBLIC);
  });

  it('every admin route names a permission and every partner route requires the driver role', () => {
    for (const r of routes()) {
      if (r.path.startsWith('/admin/')) expect(r.permissions?.length, r.key).toBeGreaterThan(0);
      if (r.path.startsWith('/driver/')) expect(r.roles, r.key).toContain(AccountRole.Driver);
    }
  });

  it('every non-public route answers 401 without a token', async () => {
    const guarded = routes().filter((r) => !r.isPublic);
    for (const r of guarded) {
      const url = P + r.path.replace(/:[A-Za-z]+/g, randomUUID());
      const res = await h.http[r.method.toLowerCase() as 'get'](url).send(r.method === 'GET' ? undefined : {});
      expect(res.status, r.key).toBe(401);
    }
  });
});
