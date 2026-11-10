import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp, mountSwagger } from './bootstrap.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  configureApp(app, config);
  mountSwagger(app, config);
  await app.listen(config.port);
  app.get(Logger).log(`${config.appName} API listening on :${config.port} (${config.nodeEnv})`, 'Bootstrap');
}

await bootstrap();
