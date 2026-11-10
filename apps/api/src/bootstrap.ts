import { ValidationPipe, type INestApplication, type ValidationError } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { API_PREFIX, CLIENT_PLATFORM_HEADER, IDEMPOTENCY_KEY_HEADER, REQUEST_ID_HEADER, type FieldError } from '@payana/contracts';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppError } from './common/errors/app-error.js';
import { ProblemFilter } from './common/errors/problem.filter.js';
import { requestContextMiddleware } from './common/http/request-context.js';
import type { AppConfig } from './config/env.js';

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    for (const message of Object.values(e.constraints ?? {})) out.push({ field, message });
    if (e.children?.length) out.push(...flatten(e.children, field));
  }
  return out;
}

/**
 * Everything that makes a bare Nest application behave like the Payana API.
 * Shared by `main.ts` and the end-to-end tests so both exercise the same
 * pipes, filters, headers and prefix.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  express.set('trust proxy', config.trustProxy);
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: '256kb' });
  express.useBodyParser('urlencoded', { limit: '64kb', extended: false });

  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.use(
    helmet({
      // The API serves JSON and signed file downloads only; it never renders HTML
      // apart from the Swagger UI, which is disabled in production.
      contentSecurityPolicy: config.swaggerEnabled ? false : undefined,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', IDEMPOTENCY_KEY_HEADER, CLIENT_PLATFORM_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After', 'Idempotent-Replayed'],
    maxAge: 600,
  });
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
      exceptionFactory: (errors) => AppError.validation(flatten(errors)),
    }),
  );
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication, config: AppConfig): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle(`${config.appName} API`)
    .setDescription(
      'Hyperlocal mobility and travel marketplace API. Request and response schemas are generated from ' +
        'the shared contract package (`packages/contracts`). Errors are RFC 9457 problem documents.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addCookieAuth('payana_rt', { type: 'apiKey', in: 'cookie', description: 'Rotating refresh token (HttpOnly)' })
    .build();
  return SwaggerModule.createDocument(app, builder);
}

export function mountSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.swaggerEnabled) return;
  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app, config), {
    jsonDocumentUrl: 'api/docs-json',
  });
}

/** Turns a contract route builder into a Nest route pattern: r(ApiRoutes.x.one(':id')). */
export const r = (path: string): string => decodeURIComponent(path);
