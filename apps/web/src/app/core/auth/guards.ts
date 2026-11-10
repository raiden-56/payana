import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import type { Permission } from '@payana/contracts';
import { AuthStore } from './auth.store';

/**
 * Route guards. These exist so people land on the right screen - they are not
 * a security boundary. Every protected API call is authorised by the server.
 */

function signInTree(router: Router, returnUrl: string, intent?: 'driver'): UrlTree {
  return router.createUrlTree(['/sign-in'], {
    queryParams: { returnUrl, ...(intent ? { intent } : {}) },
  });
}

/** Any signed-in account. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  return auth.isAuthenticated() ? true : signInTree(inject(Router), state.url);
};

/** Signed-in customer. A driver-only account is asked to sign in as a customer. */
export const customerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return signInTree(router, state.url);
  if (auth.isCustomer()) return true;
  return router.createUrlTree([auth.isAdmin() ? '/admin' : '/partner']);
};

/** Signed-in driver / vehicle owner. */
export const partnerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return signInTree(router, state.url, 'driver');
  if (auth.isDriver()) return true;
  // A customer who wants to drive joins from the "Drive with us" page.
  return router.createUrlTree(['/drive']);
};

/** Signed-in administrator. */
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  return router.createUrlTree(['/admin/sign-in'], { queryParams: { returnUrl: state.url } });
};

/** Administrator holding one specific permission; others go to the console home. */
export function permissionGuard(permission: Permission): CanActivateFn {
  return () => {
    const auth = inject(AuthStore);
    return auth.hasPermission(permission) ? true : inject(Router).createUrlTree(['/admin']);
  };
}

/** Sign-in screens: someone already signed in is sent on their way. */
export const guestGuard: CanActivateFn = (route) => {
  const auth = inject(AuthStore);
  if (!auth.isAuthenticated()) return true;
  const router = inject(Router);
  const returnUrl = route.queryParamMap.get('returnUrl');
  return router.parseUrl(safeReturnUrl(returnUrl) ?? homeFor(auth));
};

/** Where an account lands after signing in when no return URL was given. */
export function homeFor(auth: AuthStore): string {
  if (auth.isAdmin()) return '/admin';
  if (auth.isDriver() && !auth.isCustomer()) return '/partner';
  return '/';
}

/** Only same-app paths are accepted, so a crafted link cannot bounce people to another site. */
export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value;
}
