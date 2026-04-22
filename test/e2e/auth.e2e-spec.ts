/**
 * E2E tests for the Auth module.
 *
 * Bootstraps a real Nest app with the same pipes/filters as main.ts,
 * and hits HTTP endpoints via supertest. Requires a reachable Postgres
 * DB (DATABASE_URL env var) — the CI pipeline provides one via a
 * Postgres service container.
 *
 * Scope:
 *  - Validation errors (happen BEFORE DB is touched)
 *  - Register happy path (hits DB, creates User + VerificationToken)
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@/core/database/prisma.service';
import { AllExceptionsFilter } from '@/core/filters/http-exception.filter';
import { MailService } from '@/core/mail/mail.service';
import { AppModule } from '../../src/app.module';

// Unique prefix per run so parallel CI runs don't collide
const TEST_EMAIL_PREFIX = `e2e-${Date.now()}`;

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Stub MailService — avoids real Resend API calls in CI.
      // Register still completes and persists the user + OTP token.
      .overrideProvider(MailService)
      .useValue({
        sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
        sendResetPasswordEmail: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleFixture.createNestApplication();

    // Replicate production middleware so validation behaves the same
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Clean up any users created during this run
    await prisma.user.deleteMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
    });
    await app.close();
  });

  describe('POST /auth/register — validation', () => {
    it('rejects a missing email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Test', password: 'Pass@123' });

      expect(res.status).toBe(400);
    });

    it('rejects an invalid email format', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Test',
          email: 'not-an-email',
          password: 'Pass@123',
        });

      expect(res.status).toBe(400);
    });

    it('rejects a password that does not meet complexity rules', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Test',
          email: `${TEST_EMAIL_PREFIX}-weak@test.com`,
          password: 'weak',
        });

      expect(res.status).toBe(400);
    });

    it('rejects a missing name', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `${TEST_EMAIL_PREFIX}-noname@test.com`,
          password: 'Pass@123',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/register — happy path', () => {
    it('creates a new user with valid input and returns 201', async () => {
      const email = `${TEST_EMAIL_PREFIX}-ok@test.com`;

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Test User', email, password: 'Pass@123' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message');

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user?.emailVerified).toBeNull();
    });
  });
});
