import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import {
  ADMIN_ROLE_PERMISSIONS,
  AccountRole,
  AdminRole,
  EMPTY_ANALYTICS_SETTINGS,
  DEFAULT_FEATURE_FLAGS,
  LocationFreshness,
  Permission,
  type PlatformSettings,
} from '@payana/contracts';
import { PermissionsGuard, RolesGuard } from './auth/guards.js';
import type { AuthUser } from './auth/auth.types.js';
import { decrypt, encrypt, maskPhone, maskRegistration, signPayload, verifyPayload } from './crypto.js';
import { AppError } from './errors/app-error.js';
import { classifyFreshness, haversineKm, isFresh, roundBearing } from './geo.js';
import { validateSettingsUpdate } from '../modules/platform/domain/settings-rules.js';
import {
  nextVerificationStatus,
  normalizeRegistration,
  onboardingChecklist,
  validateRates,
} from '../modules/marketplace/domain/marketplace-rules.js';
import { estimateFare } from '../modules/catalog/domain/fare-estimate.js';
import { matchesDeclaredType } from '../modules/storage/application/storage.port.js';

describe('location freshness', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const ago = (s: number) => new Date(now.getTime() - s * 1000);

  it('classifies by age and never calls an old position current', () => {
    expect(classifyFreshness(null, now)).toBe(LocationFreshness.Unknown);
    expect(classifyFreshness(ago(0), now)).toBe(LocationFreshness.Live);
    expect(classifyFreshness(ago(120), now)).toBe(LocationFreshness.Live);
    expect(classifyFreshness(ago(121), now)).toBe(LocationFreshness.Recent);
    expect(classifyFreshness(ago(900), now)).toBe(LocationFreshness.Recent);
    expect(classifyFreshness(ago(901), now)).toBe(LocationFreshness.Stale);
    expect(classifyFreshness(ago(86_400), now)).toBe(LocationFreshness.Stale);
  });

  it('only live and recent positions may carry a distance', () => {
    expect(isFresh(LocationFreshness.Live) && isFresh(LocationFreshness.Recent)).toBe(true);
    expect(isFresh(LocationFreshness.Stale) || isFresh(LocationFreshness.Unknown)).toBe(false);
  });

  it('measures distance and coarsens bearings', () => {
    const busStand = { lat: 14.5452, lng: 74.3197 };
    const omBeach = { lat: 14.5192, lng: 74.3243 };
    expect(haversineKm(busStand, omBeach)).toBeGreaterThan(2.8);
    expect(haversineKm(busStand, omBeach)).toBeLessThan(3.0);
    expect(haversineKm(busStand, busStand)).toBe(0);
    expect(roundBearing(4)).toBe(0);
    expect(roundBearing(356)).toBe(0);
    expect(roundBearing(184.9)).toBe(180);
    expect(roundBearing(-5)).toBe(0);
  });
});

describe('analytics and ads settings validation', () => {
  const current: PlatformSettings = {
    analytics: EMPTY_ANALYTICS_SETTINGS,
    features: DEFAULT_FEATURE_FLAGS,
    support: { phone: '', whatsapp: '', email: '' },
    bookingFee: { enabled: false, flatMinor: 0, percent: 0, capMinor: null },
    defaultRegionSlug: 'gokarna',
  };
  const errorsOf = (update: unknown): string[] => {
    try {
      validateSettingsUpdate(current, update as never, ['gokarna', 'kumta']);
      return [];
    } catch (e) {
      return (e as AppError).extra.errors?.map((x) => x.field) ?? ['?'];
    }
  };

  it('accepts real-looking identifiers and stores them trimmed', () => {
    const next = validateSettingsUpdate(
      current,
      {
        analytics: {
          ...EMPTY_ANALYTICS_SETTINGS,
          ga4MeasurementId: ' G-AB12CD34EF ',
          googleAdsId: 'AW-1234567890',
          googleAdsConversionLabels: { booking_confirmed: 'AbC-D_efG-h12_34-567' },
          adsensePublisherId: 'ca-pub-1234567890123456',
          adsenseSlots: { home_strip: '1234567890' },
        },
      },
      ['gokarna'],
    );
    expect(next.analytics.ga4MeasurementId).toBe('G-AB12CD34EF');
    expect(next.analytics.googleAdsConversionLabels).toEqual({ booking_confirmed: 'AbC-D_efG-h12_34-567' });
    expect(next.analytics.requireConsent).toBe(true);
  });

  it('treats an empty identifier as "off", which is valid', () => {
    expect(errorsOf({ analytics: { ga4MeasurementId: '', googleAdsId: '', adsensePublisherId: '' } })).toEqual([]);
  });

  it('rejects malformed identifiers and names each field', () => {
    expect(errorsOf({ analytics: { ga4MeasurementId: 'UA-12345-1' } })).toEqual(['analytics.ga4MeasurementId']);
    expect(errorsOf({ analytics: { googleAdsId: 'G-AB12CD34EF' } })).toEqual(['analytics.googleAdsId']);
    expect(errorsOf({ analytics: { adsensePublisherId: 'pub-123' } })).toEqual(['analytics.adsensePublisherId']);
    expect(errorsOf({ analytics: { googleAdsConversionLabels: { booking_confirmed: 'x y' } } })).toEqual([
      'analytics.googleAdsConversionLabels.booking_confirmed',
    ]);
    expect(errorsOf({ analytics: { googleAdsConversionLabels: { made_up: 'AbCdEfGh' } } })).toEqual(['analytics.googleAdsConversionLabels.made_up']);
    expect(errorsOf({ analytics: { adsenseSlots: { home_strip: 'abc' } } })).toEqual(['analytics.adsenseSlots.home_strip']);
    expect(errorsOf({ analytics: { ga4MeasurementId: '<script>' } })).toEqual(['analytics.ga4MeasurementId']);
  });

  it('validates the other sections too', () => {
    expect(errorsOf({ features: { nope: true } })).toEqual(['features.nope']);
    expect(errorsOf({ bookingFee: { percent: 25 } })).toEqual(['bookingFee.percent']);
    expect(errorsOf({ support: { phone: '12345' } })).toEqual(['support.phone']);
    expect(errorsOf({ defaultRegionSlug: 'atlantis' })).toEqual(['defaultRegionSlug']);
    expect(errorsOf({ secrets: {} })).toEqual(['secrets']);
    expect(errorsOf({ features: { reviews: false }, defaultRegionSlug: 'kumta' })).toEqual([]);
  });
});

describe('permission matrix', () => {
  const has = (role: AdminRole, p: Permission) => ADMIN_ROLE_PERMISSIONS[role].includes(p);

  it('gives the privileged role everything', () => {
    expect([...ADMIN_ROLE_PERMISSIONS[AdminRole.SuperAdmin]].sort()).toEqual(Object.values(Permission).sort());
  });

  it('keeps staff, settings and audit powers away from every other role', () => {
    for (const role of Object.values(AdminRole).filter((r) => r !== AdminRole.SuperAdmin)) {
      expect(has(role, Permission.StaffManage), role).toBe(false);
      expect(has(role, Permission.SettingsManage), role).toBe(false);
      expect(has(role, Permission.AuditRead), role).toBe(false);
    }
  });

  it('separates duties between the working roles', () => {
    expect(has(AdminRole.VerificationOfficer, Permission.VerificationReview)).toBe(true);
    expect(has(AdminRole.VerificationOfficer, Permission.RefundsProcess)).toBe(false);
    expect(has(AdminRole.SupportAgent, Permission.BookingsResolve)).toBe(true);
    expect(has(AdminRole.SupportAgent, Permission.VerificationReview)).toBe(false);
    expect(has(AdminRole.FinanceManager, Permission.PlansManage)).toBe(true);
    expect(has(AdminRole.FinanceManager, Permission.UsersSuspend)).toBe(false);
    expect(has(AdminRole.MarketingManager, Permission.AdsManage)).toBe(true);
    expect(has(AdminRole.MarketingManager, Permission.BookingsRead)).toBe(false);
  });
});

describe('authorisation guards', () => {
  const user = (over: Partial<AuthUser>): AuthUser => ({
    id: 'u1', sessionId: 's1', roles: [AccountRole.Customer], status: 'active', displayName: null, phone: null, email: null,
    adminRole: null, permissions: [], driverProfileId: null, driverVerificationStatus: null, ...over,
  });
  const ctx = (u?: AuthUser) =>
    ({ getHandler: () => undefined, getClass: () => undefined, switchToHttp: () => ({ getRequest: () => ({ user: u }) }) }) as unknown as ExecutionContext;
  const reflecting = (value: unknown) => ({ getAllAndOverride: () => value }) as unknown as Reflector;
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return 'allowed';
    } catch (e) {
      return (e as AppError).code;
    }
  };

  it('RolesGuard admits only accounts holding a required role', () => {
    const guard = new RolesGuard(reflecting([AccountRole.Driver]));
    expect(codeOf(() => guard.canActivate(ctx(user({ roles: [AccountRole.Customer, AccountRole.Driver] }))))).toBe('allowed');
    expect(codeOf(() => guard.canActivate(ctx(user({}))))).toBe('forbidden');
    expect(codeOf(() => guard.canActivate(ctx(undefined)))).toBe('unauthenticated');
    expect(new RolesGuard(reflecting(undefined)).canActivate(ctx(user({})))).toBe(true);
  });

  it('PermissionsGuard needs an administrator holding every listed permission', () => {
    const guard = new PermissionsGuard(reflecting([Permission.SettingsManage]));
    const superAdmin = user({ roles: [AccountRole.Admin], adminRole: AdminRole.SuperAdmin, permissions: [...ADMIN_ROLE_PERMISSIONS.super_admin] });
    const support = user({ roles: [AccountRole.Admin], adminRole: AdminRole.SupportAgent, permissions: [...ADMIN_ROLE_PERMISSIONS.support_agent] });
    expect(codeOf(() => guard.canActivate(ctx(superAdmin)))).toBe('allowed');
    expect(codeOf(() => guard.canActivate(ctx(support)))).toBe('forbidden');
    // A customer who somehow carries the permission string but no admin role is still refused.
    expect(codeOf(() => guard.canActivate(ctx(user({ permissions: [Permission.SettingsManage] }))))).toBe('forbidden');
    expect(codeOf(() => guard.canActivate(ctx(undefined)))).toBe('unauthenticated');
  });
});

describe('crypto helpers', () => {
  const key = Buffer.alloc(32, 7);

  it('encrypts and decrypts, with a different ciphertext each time', () => {
    const a = encrypt('KA4720200012345', key);
    expect(a).not.toBe(encrypt('KA4720200012345', key));
    expect(decrypt(a, key)).toBe('KA4720200012345');
    expect(() => decrypt(a, Buffer.alloc(32, 8))).toThrow();
  });

  it('rejects tampered, expired and foreign signed tokens', () => {
    const secret = 's'.repeat(40);
    const token = signPayload({ k: 'file', exp: Date.now() + 60_000 }, secret);
    expect(verifyPayload<{ k: string; exp: number }>(token, secret)?.k).toBe('file');
    expect(verifyPayload(token, 'x'.repeat(40))).toBeNull();
    expect(verifyPayload(`${token.split('.')[0]}x.${token.split('.')[1]}`, secret)).toBeNull();
    expect(verifyPayload(signPayload({ exp: Date.now() - 1 }, secret), secret)).toBeNull();
    expect(verifyPayload('garbage', secret)).toBeNull();
  });

  it('masks phone and registration numbers', () => {
    expect(maskPhone('+919000000201')).toBe('+91 •••••• 0201');
    expect(maskRegistration('KA47A4821')).toBe('KA 47 •• 4821');
    expect(maskRegistration('ODD-PLATE-99')).toContain('••••');
  });
});

describe('marketplace rules', () => {
  it('normalises Indian registration numbers and rejects others', () => {
    expect(normalizeRegistration('ka 47-a 4821')).toBe('KA47A4821');
    expect(normalizeRegistration('KA47 4821')).toBe('KA474821');
    expect(normalizeRegistration('HELLO')).toBeNull();
  });

  it('keeps published rates inside the category band', () => {
    const bounds = { minPerKmMinor: 1400, maxPerKmMinor: 3000, baseFareMinor: 4000, perHourWaitingMinor: 6000 };
    expect(validateRates({ baseFareMinor: 4000, perKmMinor: 1800, perHourWaitingMinor: 6000 }, bounds)).toEqual([]);
    expect(validateRates({ baseFareMinor: 4000, perKmMinor: 1399, perHourWaitingMinor: 6000 }, bounds).map((e) => e.field)).toEqual(['perKmMinor']);
    expect(validateRates({ baseFareMinor: 12_001, perKmMinor: 3001, perHourWaitingMinor: 18_001 }, bounds).map((e) => e.field)).toEqual([
      'perKmMinor', 'baseFareMinor', 'perHourWaitingMinor',
    ]);
  });

  it('tracks what a partner still owes before review', () => {
    const doc = (type: string, vehicleId: string | null, status = 'pending') => ({ type, vehicleId, status, expiresOn: null }) as never;
    const vehicleDocs = ['vehicle_registration', 'insurance', 'permit', 'fitness'].map((t) => doc(t, 'v1'));
    const complete = onboardingChecklist({
      hasProfile: true, partnerType: 'owner_driver', vehicleIds: ['v1'],
      documents: [doc('identity', null), doc('driving_licence', null, 'approved'), ...vehicleDocs],
    });
    expect(complete.readyForReview).toBe(true);
    const missingLicence = onboardingChecklist({ hasProfile: true, partnerType: 'owner_driver', vehicleIds: ['v1'], documents: [doc('identity', null), ...vehicleDocs] });
    expect(missingLicence).toMatchObject({ personDocuments: false, readyForReview: false });
    const rejected = onboardingChecklist({
      hasProfile: true, partnerType: 'owner_driver', vehicleIds: ['v1'],
      documents: [doc('identity', null), doc('driving_licence', null), ...vehicleDocs.slice(1), doc('vehicle_registration', 'v1', 'rejected')],
    });
    expect(rejected.vehicleDocuments).toBe(false);
    // A hired driver operates someone else's vehicle; a fleet owner needs no licence.
    expect(onboardingChecklist({ hasProfile: true, partnerType: 'hired_driver', vehicleIds: [], documents: [doc('identity', null), doc('driving_licence', null)] }).readyForReview).toBe(true);
    expect(onboardingChecklist({ hasProfile: true, partnerType: 'fleet_owner', vehicleIds: ['v1'], documents: [doc('identity', null), ...vehicleDocs] }).readyForReview).toBe(true);
  });

  it('allows only sensible verification decisions', () => {
    expect(nextVerificationStatus('pending', 'approve')).toBe('approved');
    expect(nextVerificationStatus('incomplete', 'approve')).toBeNull();
    expect(nextVerificationStatus('approved', 'suspend')).toBe('suspended');
    expect(nextVerificationStatus('suspended', 'reinstate')).toBe('approved');
    expect(nextVerificationStatus('approved', 'reject')).toBeNull();
  });

  it('estimates a fare as a range, low never above high', () => {
    const e = estimateFare({ lat: 14.5452, lng: 74.3197 }, { lat: 14.5192, lng: 74.3243 }, { baseFareMinor: 4000, minPerKmMinor: 1400, maxPerKmMinor: 3000 });
    expect(e.basis).toBe('straight_line');
    expect(e.low.amountMinor).toBeLessThanOrEqual(e.high.amountMinor);
    expect(e.low.amountMinor % 1000).toBe(0);
    expect(e.distanceKm).toBeGreaterThan(3);
  });

  it('checks uploaded bytes against the declared type', () => {
    expect(matchesDeclaredType('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesDeclaredType('image/jpeg', Buffer.from('<html>'))).toBe(false);
    expect(matchesDeclaredType('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(matchesDeclaredType('text/html', Buffer.from('<html>'))).toBe(false);
  });
});
