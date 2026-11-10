import { Routes } from '@angular/router';
import { Permission } from '@payana/contracts';
import { adminGuard, permissionGuard } from '@core/auth/guards';
import { AdminCounts, AdminLayout } from './admin-layout';

/**
 * The admin console. `adminGuard` keeps non-staff out of the area and each
 * screen adds `permissionGuard` for the permission its endpoints require.
 * These guards only decide what is offered - the API authorises every call.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    canActivate: [adminGuard],
    providers: [AdminCounts],
    children: [
      {
        // Every admin role holds overview.read; the page itself copes if one does not.
        path: '',
        pathMatch: 'full',
        title: 'Admin overview',
        loadComponent: () => import('./overview/overview').then((m) => m.AdminOverviewPage),
      },
      {
        path: 'verifications',
        title: 'Verifications',
        canActivate: [permissionGuard(Permission.VerificationRead)],
        loadComponent: () => import('./verifications/verification-queue').then((m) => m.VerificationQueue),
      },
      {
        path: 'verifications/:id',
        title: 'Verification case',
        canActivate: [permissionGuard(Permission.VerificationRead)],
        loadComponent: () => import('./verifications/verification-case').then((m) => m.VerificationCasePage),
      },
      {
        path: 'users',
        title: 'Users',
        canActivate: [permissionGuard(Permission.UsersRead)],
        loadComponent: () => import('./users/users').then((m) => m.AdminUsers),
      },
      {
        path: 'bookings',
        title: 'Bookings',
        canActivate: [permissionGuard(Permission.BookingsRead)],
        loadComponent: () => import('./bookings/bookings').then((m) => m.AdminBookings),
      },
      {
        path: 'bookings/:id',
        title: 'Booking',
        canActivate: [permissionGuard(Permission.BookingsRead)],
        loadComponent: () => import('./bookings/booking-case').then((m) => m.AdminBookingCase),
      },
      {
        path: 'catalog',
        title: 'Regions and vehicles',
        canActivate: [permissionGuard(Permission.CatalogManage)],
        loadComponent: () => import('./catalog/catalog').then((m) => m.AdminCatalog),
      },
      {
        path: 'plans',
        title: 'Plans',
        canActivate: [permissionGuard(Permission.PlansManage)],
        loadComponent: () => import('./plans/plans').then((m) => m.AdminPlans),
      },
      {
        path: 'packages',
        title: 'Tour packages',
        canActivate: [permissionGuard(Permission.PackagesManage)],
        loadComponent: () => import('./packages/packages').then((m) => m.AdminPackages),
      },
      {
        path: 'ads',
        title: 'Advertisements',
        canActivate: [permissionGuard(Permission.AdsManage)],
        loadComponent: () => import('./ads/ads').then((m) => m.AdminAds),
      },
      {
        path: 'support',
        title: 'Support',
        canActivate: [permissionGuard(Permission.SupportManage)],
        loadComponent: () => import('./support/tickets').then((m) => m.AdminTickets),
      },
      {
        path: 'support/:id',
        title: 'Support ticket',
        canActivate: [permissionGuard(Permission.SupportManage)],
        loadComponent: () => import('./support/ticket-thread').then((m) => m.AdminTicketThread),
      },
      {
        path: 'audit',
        title: 'Audit log',
        canActivate: [permissionGuard(Permission.AuditRead)],
        loadComponent: () => import('./audit/audit').then((m) => m.AdminAudit),
      },
      {
        path: 'staff',
        title: 'Staff',
        canActivate: [permissionGuard(Permission.StaffManage)],
        loadComponent: () => import('./staff/staff').then((m) => m.AdminStaff),
      },
      {
        path: 'settings',
        title: 'Settings',
        canActivate: [permissionGuard(Permission.SettingsRead)],
        loadComponent: () => import('@features/admin/settings/settings').then((m) => m.AdminSettings),
      },
    ],
  },
];
