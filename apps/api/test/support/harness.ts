import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountRole, ApiRoutes, API_PREFIX, type AdminRole, type AuthSession, type Me } from '@payana/contracts';
import argon2 from 'argon2';
import { generate, generateSecret } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import { encrypt } from '../../src/common/crypto.js';
import { Db } from '../../src/common/db/db.service.js';
import { OutboxService } from '../../src/common/outbox/outbox.service.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/env.js';

export const P = API_PREFIX;
export const GOKARNA_BUS_STAND = { lat: 14.5452, lng: 74.3197 };
export const OM_BEACH = { lat: 14.5192, lng: 74.3243 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const STAFF_PASSWORD = 'Test-Staff-Password-2026!';
let plateCounter = 1000 + randomInt(0, 4000);

export interface Signed {
  token: string;
  me: Me;
  phone: string;
  refreshToken?: string;
  cookies: string[];
}

export interface Partner extends Signed {
  profileId: string;
  vehicleId: string;
}

/** The real application, plus the small vocabulary the end-to-end tests are written in. */
export class Harness {
  private constructor(
    readonly app: INestApplication<App>,
    readonly db: Db,
    readonly config: AppConfig,
  ) {}

  static async boot(): Promise<Harness> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>();
    const config = app.get<AppConfig>(APP_CONFIG);
    configureApp(app, config);
    await app.init();
    return new Harness(app, app.get(Db), config);
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  get http() {
    return request(this.app.getHttpServer());
  }

  bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  key(): string {
    return `test-${randomUUID()}`;
  }

  phone(): string {
    return `+919${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`;
  }

  plate(): string {
    plateCounter += 1;
    return `KA47T${String(plateCounter).padStart(4, '0')}`;
  }

  async flushEvents(): Promise<void> {
    await this.app.get(OutboxService).flush();
  }

  // --- identity -------------------------------------------------------------------------

  async requestOtp(phone: string, intent: 'customer' | 'driver' = 'customer') {
    const res = await this.http.post(P + ApiRoutes.auth.otpRequest).send({ phone, intent }).expect(200);
    return res.body as { challengeId: string; devCode: string };
  }

  async signIn(intent: 'customer' | 'driver' = 'customer', opts: { phone?: string; native?: boolean } = {}): Promise<Signed> {
    const phone = opts.phone ?? this.phone();
    const challenge = await this.requestOtp(phone, intent);
    const req = this.http.post(P + ApiRoutes.auth.otpVerify);
    if (opts.native) req.set('X-Client-Platform', 'native');
    const res = await req.send({ challengeId: challenge.challengeId, code: challenge.devCode, intent }).expect(200);
    const session = res.body as AuthSession;
    return {
      token: session.accessToken,
      me: session.me,
      phone,
      refreshToken: session.refreshToken,
      cookies: (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [],
    };
  }

  /** Creates a staff account directly (as an operator would) and signs it in with password + TOTP. */
  async staff(role: AdminRole, opts: { enrolled?: boolean } = {}): Promise<{ token: string; email: string; id: string }> {
    const email = `${role}-${randomUUID().slice(0, 8)}@payana.test`;
    const secret = generateSecret();
    const enrolled = opts.enrolled ?? true;
    const row = await this.db.insert<{ id: string }>('users', {
      email,
      display_name: `Test ${role}`,
      roles: [AccountRole.Admin],
      admin_role: role,
      password_hash: await argon2.hash(STAFF_PASSWORD),
      mfa_secret_enc: enrolled ? encrypt(secret, this.config.auth.dataEncryptionKey) : null,
      mfa_enabled: enrolled,
    });
    const login = await this.http.post(P + ApiRoutes.auth.adminLogin).send({ email, password: STAFF_PASSWORD }).expect(200);
    if (login.body.status === 'authenticated') return { token: login.body.session.accessToken, email, id: row.id };
    const useSecret = login.body.status === 'mfa_enrollment_required' ? (login.body.secret as string) : secret;
    const mfa = await this.http
      .post(P + ApiRoutes.auth.adminMfaVerify)
      .send({ mfaToken: login.body.mfaToken, code: await generate({ secret: useSecret }) })
      .expect(200);
    return { token: (mfa.body as AuthSession).accessToken, email, id: row.id };
  }

  staffPassword(): string {
    return STAFF_PASSWORD;
  }

  // --- partner onboarding -------------------------------------------------------------------

  async upload(token: string, purpose = 'driver_document'): Promise<string> {
    const presign = await this.http
      .post(P + ApiRoutes.uploads.presign)
      .set(this.bearer(token))
      .send({ purpose, contentType: 'image/png', sizeBytes: PNG.length })
      .expect(200);
    await this.http.put(presign.body.uploadUrl).set('Content-Type', 'image/png').send(PNG).expect(204);
    return presign.body.fileKey as string;
  }

  /** Signs a partner in and takes them as far as "submitted for review". */
  async onboardPartner(categoryCode = 'auto'): Promise<Partner> {
    const signed = await this.signIn('driver');
    const auth = this.bearer(signed.token);
    const profile = await this.http
      .put(P + ApiRoutes.driver.profile)
      .set(auth)
      .send({ partnerType: 'owner_driver', displayName: 'Test Driver', languages: ['Kannada', 'English'], serviceAreas: ['gokarna'], yearsExperience: 5 })
      .expect(200);
    const vehicle = await this.http
      .post(P + ApiRoutes.driver.vehicles)
      .set(auth)
      .send({ categoryCode, make: 'Bajaj', model: 'RE', registrationNumber: this.plate(), seats: 3, luggageCapacity: 1, hasAc: false })
      .expect(201);
    const future = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    const docs: [string, boolean, boolean][] = [
      ['identity', false, false],
      ['driving_licence', false, true],
      ['vehicle_registration', true, false],
      ['insurance', true, true],
      ['permit', true, true],
      ['fitness', true, true],
    ];
    for (const [type, forVehicle, expires] of docs) {
      await this.http
        .post(P + ApiRoutes.driver.documents)
        .set(auth)
        .send({
          type,
          fileKey: await this.upload(signed.token),
          documentNumber: `DOC${randomInt(100000, 999999)}`,
          ...(forVehicle ? { vehicleId: vehicle.body.id } : {}),
          ...(expires ? { expiresOn: future } : {}),
        })
        .expect(201);
    }
    await this.http.post(P + ApiRoutes.driver.submitForReview).set(auth).expect(200);
    return { ...signed, profileId: profile.body.id, vehicleId: vehicle.body.id };
  }

  /** An officer approves every pending document and then the partner. */
  async approve(officerToken: string, profileId: string): Promise<void> {
    const auth = this.bearer(officerToken);
    const kase = await this.http.get(P + ApiRoutes.admin.verification(profileId)).set(auth).expect(200);
    for (const doc of kase.body.documents as { id: string; status: string }[]) {
      if (doc.status !== 'pending') continue;
      await this.http.post(P + ApiRoutes.admin.reviewDocument(doc.id)).set(auth).send({ decision: 'approve' }).expect(200);
    }
    await this.http.post(P + ApiRoutes.admin.decideVerification(profileId)).set(auth).send({ decision: 'approve' }).expect(200);
  }

  async goOnline(partner: Partner, at = GOKARNA_BUS_STAND): Promise<void> {
    const auth = this.bearer(partner.token);
    await this.http.put(P + ApiRoutes.driver.availability).set(auth).send({ status: 'available', vehicleId: partner.vehicleId }).expect(200);
    await this.http
      .post(P + ApiRoutes.driver.location)
      .set(auth)
      .send({ location: at, accuracyMeters: 12, recordedAt: new Date().toISOString() })
      .expect(204);
  }

  /** A verified partner who is online near the Gokarna bus stand. */
  async onlinePartner(officerToken: string): Promise<Partner> {
    const partner = await this.onboardPartner();
    await this.approve(officerToken, partner.profileId);
    await this.goOnline(partner);
    return partner;
  }

  // --- requests and quotes ------------------------------------------------------------------

  rideRequestBody(over: Record<string, unknown> = {}) {
    return {
      tripType: 'immediate',
      pickup: { label: 'Gokarna Bus Stand', location: GOKARNA_BUS_STAND },
      drop: { label: 'Om Beach', location: OM_BEACH },
      categoryCode: 'auto',
      passengers: 2,
      ...over,
    };
  }

  async createRequest(customerToken: string, over: Record<string, unknown> = {}) {
    const res = await this.http
      .post(P + ApiRoutes.rideRequests.root)
      .set(this.bearer(customerToken))
      .set('Idempotency-Key', this.key())
      .send(this.rideRequestBody(over))
      .expect(201);
    return res.body as { id: string; status: string; driversNotified: number };
  }

  async quote(partner: Partner, requestId: string, fareMinor = 15_000) {
    const res = await this.http
      .post(P + ApiRoutes.driver.quotes(requestId))
      .set(this.bearer(partner.token))
      .set('Idempotency-Key', this.key())
      .send({ vehicleId: partner.vehicleId, fareMinor, validForMinutes: 10, etaMinutes: 5, inclusions: ['Fuel'] })
      .expect(201);
    return res.body as { id: string };
  }

  accept(customerToken: string, requestId: string, quoteId: string) {
    return this.http
      .post(P + ApiRoutes.rideRequests.acceptQuote(requestId, quoteId))
      .set(this.bearer(customerToken))
      .set('Idempotency-Key', this.key());
  }
}
