import { Routes } from '@angular/router';
import { partnerGuard } from '@core/auth/guards';
import { PartnerLayout, hasProfileGuard } from './partner-layout';

/**
 * The partner (driver / vehicle owner) area. Guards only steer people to the
 * right screen; the API checks the driver role, verification and ownership on
 * every call.
 */
export const PARTNER_ROUTES: Routes = [
  {
    path: '',
    component: PartnerLayout,
    canActivate: [partnerGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Partner dashboard',
        loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'onboarding',
        title: 'Get verified',
        loadComponent: () => import('./onboarding/onboarding').then((m) => m.Onboarding),
      },
      {
        path: 'profile',
        title: 'Your profile',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./profile/profile').then((m) => m.Profile),
      },
      {
        path: 'requests',
        title: 'Requests',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./requests/requests').then((m) => m.Requests),
      },
      {
        path: 'requests/:id',
        title: 'Ride request',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./requests/request-detail').then((m) => m.RequestDetail),
      },
      {
        path: 'bookings',
        title: 'Bookings',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./bookings/bookings').then((m) => m.Bookings),
      },
      {
        // The same booking screen customers use; the API decides what each party may do.
        path: 'bookings/:id',
        title: 'Booking',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('@features/booking/booking-detail').then((m) => m.BookingDetail),
      },
      {
        path: 'vehicles',
        title: 'Vehicles',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./vehicles/vehicles').then((m) => m.Vehicles),
      },
      {
        path: 'documents',
        title: 'Documents',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./documents/documents').then((m) => m.Documents),
      },
      {
        path: 'team',
        title: 'Team',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./team/team').then((m) => m.Team),
      },
      {
        path: 'plan',
        title: 'Plan and billing',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./plan/plan').then((m) => m.Plan),
      },
      {
        path: 'reviews',
        title: 'Reviews',
        canActivate: [hasProfileGuard],
        loadComponent: () => import('./reviews/reviews').then((m) => m.Reviews),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
