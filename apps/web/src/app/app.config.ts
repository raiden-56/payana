import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  Injectable,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  RouterStateSnapshot,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { authInterceptor } from '@core/auth/auth.interceptor';
import { AuthStore } from '@core/auth/auth.store';
import { BRAND } from '@core/brand';
import { AppConfigService } from '@core/config/app-config.service';
import { prefersReducedMotion } from '@core/platform/platform';
import { routes } from './app.routes';

/** "My bookings · Payana" */
@Injectable()
class BrandTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `${page} · ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      // Cross-fade between pages. Skipped entirely for people who asked for less motion.
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition }) => {
          if (prefersReducedMotion()) transition.skipTransition();
        },
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: TitleStrategy, useClass: BrandTitleStrategy },

    // Start-up order matters: configuration first (it holds the API address and
    // the analytics IDs), then the session, then analytics - which stays off
    // until an ID is configured and the visitor has consented.
    provideAppInitializer(async () => {
      const config = inject(AppConfigService);
      const auth = inject(AuthStore);
      const analytics = inject(AnalyticsService);
      await config.load();
      await auth.bootstrap();
      analytics.start();
    }),

    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
