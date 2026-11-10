import { Routes } from '@angular/router';
import { authGuard, customerGuard, guestGuard } from '@core/auth/guards';
import { SiteLayout } from '@layout/site-layout';

/**
 * Every feature is lazy-loaded. Guards here only steer people to the right
 * screen; the API authorises every request on its own (constitution §2.5).
 *
 * Order matters: the two work areas come first, because the public layout
 * below ends in a catch-all.
 */
export const routes: Routes = [
  // --- staff sign-in and the admin console (own layout) -----------------------
  {
    path: 'admin/sign-in',
    title: 'Staff sign in',
    canActivate: [guestGuard],
    loadComponent: () => import('@features/auth/admin-sign-in').then((m) => m.AdminSignIn),
  },
  {
    path: 'admin',
    loadChildren: () => import('@features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },

  // --- partner (driver / owner) dashboard (own layout) ---------------------------
  {
    path: 'partner',
    loadChildren: () => import('@features/partner/partner.routes').then((m) => m.PARTNER_ROUTES),
  },

  // --- public site and customer pages ----------------------------------------------
  {
    path: '',
    component: SiteLayout,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('@features/home/home').then((m) => m.Home),
      },
      {
        path: 'sign-in',
        title: 'Sign in',
        canActivate: [guestGuard],
        loadComponent: () => import('@features/auth/sign-in').then((m) => m.SignIn),
      },
      {
        path: 'explore',
        title: 'Find a ride',
        loadComponent: () => import('@features/explore/explore').then((m) => m.Explore),
      },
      {
        path: 'drivers/:id',
        title: 'Driver',
        loadComponent: () => import('@features/explore/driver-profile').then((m) => m.DriverProfile),
      },
      {
        // Open to everyone: sign-in is asked for only when the request is sent.
        path: 'request',
        title: 'Book a ride',
        loadComponent: () => import('@features/booking/request-new').then((m) => m.RequestNew),
      },
      {
        path: 'requests/:id',
        title: 'Your quotes',
        canActivate: [customerGuard],
        loadComponent: () => import('@features/booking/request-detail').then((m) => m.RequestDetail),
      },
      {
        path: 'bookings',
        title: 'My trips',
        canActivate: [customerGuard],
        loadComponent: () => import('@features/booking/my-trips').then((m) => m.MyTrips),
      },
      {
        path: 'bookings/:id',
        title: 'Booking',
        canActivate: [authGuard],
        loadComponent: () => import('@features/booking/booking-detail').then((m) => m.BookingDetail),
      },
      {
        path: 'packages',
        title: 'Sightseeing',
        loadComponent: () => import('@features/packages/packages').then((m) => m.Packages),
      },
      {
        path: 'packages/:slug',
        title: 'Sightseeing tour',
        loadComponent: () => import('@features/packages/package-detail').then((m) => m.PackageDetail),
      },
      {
        path: 'drive',
        title: 'Drive with us',
        loadComponent: () => import('@features/misc/drive').then((m) => m.Drive),
      },
      {
        path: 'help',
        title: 'Help',
        loadComponent: () => import('@features/misc/help').then((m) => m.Help),
      },
      {
        path: 'account',
        title: 'Account & privacy',
        canActivate: [authGuard],
        loadComponent: () => import('@features/account/account').then((m) => m.Account),
      },
      {
        path: 'account/notifications',
        title: 'Notifications',
        canActivate: [authGuard],
        loadComponent: () => import('@features/account/notifications').then((m) => m.Notifications),
      },
      {
        path: 'legal/privacy',
        title: 'Privacy notice',
        data: { doc: 'privacy' },
        loadComponent: () => import('@features/legal/legal').then((m) => m.Legal),
      },
      {
        path: 'legal/terms',
        title: 'Terms of use',
        data: { doc: 'terms' },
        loadComponent: () => import('@features/legal/legal').then((m) => m.Legal),
      },
      {
        path: 'legal/credits',
        title: 'Photo credits',
        loadComponent: () => import('@features/legal/credits').then((m) => m.Credits),
      },
      {
        path: '**',
        title: 'Page not found',
        loadComponent: () => import('@features/misc/not-found').then((m) => m.NotFound),
      },
    ],
  },
];
