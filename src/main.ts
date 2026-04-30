import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ENV } from '@/core/constants';
import { AppModule } from './app.module';

// Initialize Sentry before Nest bootstrap so all subsequent errors are captured.
// No-op when SENTRY_DSN is missing OR when running outside production — keeps
// local `npm run start:dev` from burning the project's event quota.
const SENTRY_ENABLED = !!ENV.SENTRY_DSN && ENV.IS_PRODUCTION;
if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: ENV.SENTRY_DSN,
    environment: ENV.SENTRY_ENV,
    tracesSampleRate: 0.1,
  });
}

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security
  app.use(
    helmet({
      hsts: false,
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    // Trim whitespace around comma-separated entries — admins occasionally
    // paste `"http://a, http://b"` (with a space) and the leading space
    // breaks the origin match silently.
    origin: ENV.CORS_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-timezone', 'x-origin'],
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Exception filter is registered via APP_FILTER in AppModule (needs DI)

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Jira API')
    .setDescription('Jira clone backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // `setup('api', ...)` mounts both the UI at `/api` and the raw spec at
  // `/api-json` (default). FE codegen pulls from `/api-json`.
  SwaggerModule.setup('api', app, document, {
    jsonDocumentUrl: 'api-json',
  });

  const port = ENV.PORT;
  await app.listen(port);
  logger.log(`Server running on http://localhost:${port}`);
  logger.log(`Swagger UI:    http://localhost:${port}/api`);
  logger.log(`OpenAPI spec:  http://localhost:${port}/api-json`);
}
void bootstrap();
