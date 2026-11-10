import type { PlanEntitlements } from '@payana/contracts';

/**
 * Cross-module ports. A module that needs something from a module it must not
 * import (to keep the dependency graph acyclic) depends on one of these
 * interfaces; the owning module binds the implementation as a global provider.
 */

/** Implemented by the billing module. */
export interface EntitlementsPort {
  /** Entitlements of the partner's current plan (the free plan when they have none). */
  forDriver(driverProfileId: string): Promise<PlanEntitlements>;
  /** Throws `entitlement_exceeded` when the plan's monthly quote limit is used up. */
  assertCanSendQuote(driverProfileId: string): Promise<void>;
  recordQuoteSent(driverProfileId: string): Promise<void>;
}
export const ENTITLEMENTS = Symbol('ENTITLEMENTS');
