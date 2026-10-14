import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  // rawBody: webhook signatures (Paystack HMAC-SHA512, Bachs HMAC-SHA256) are computed over the exact request bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  const config = app.get(AppConfig);
  const logger = new Logger('Bootstrap');

  app.set('trust proxy', 1); // Railway sits behind a proxy: needed for per-IP throttling and secure cookies.
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });

  const allowed = new Set([config.values.frontendUrl, ...config.values.extraCorsOrigins]);
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin.replace(/\/+$/, ''))),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Cart-Token'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  if (config.values.sentryDsn) logger.log('SENTRY_DSN set — wire @sentry/node here to enable error reporting');

  await app.listen(config.values.port, '0.0.0.0');
  logger.log(`Amerapelle API listening on :${config.values.port}/api/v1 (${config.values.nodeEnv})`);
}

void bootstrap();
