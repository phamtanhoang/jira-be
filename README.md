# Jira Clone — Backend API

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E)](https://nestjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748)](https://www.prisma.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://www.typescriptlang.org)

NestJS backend for a Jira-like project management tool.

📚 **[Interactive API Docs (Swagger UI)](http://localhost:3031/api)** — auto-generated from `@ApiTags` / `@ApiOperation` decorators. Try every endpoint with the cookie auth populated by your sign-in flow.

📐 **[ARCHITECTURE.md](./ARCHITECTURE.md)** — module dependency graph, façade rationale, cache tag matrix, request lifecycle.
🤝 **[CONTRIBUTING.md](./CONTRIBUTING.md)** — quick start + PR checklist + conventions.
🔒 **[SECURITY.md](./SECURITY.md)** — responsible disclosure policy.
📝 **[CHANGELOG.md](../CHANGELOG.md)** — recent changes grouped by phase.

## Tech Stack

- **Runtime:** Node.js ≥20 + TypeScript 5 (strict mode)
- **Framework:** NestJS 11
- **Database:** PostgreSQL (Neon, Supabase, or local Docker) + Prisma 7 ORM
- **Auth:** JWT + Passport — httpOnly cookies, OAuth (Google, GitHub), Personal Access Tokens
- **Email:** Resend
- **Storage:** Supabase Storage
- **Cache:** Redis (optional, in-memory fallback)
- **Docs:** Swagger (auto-generated)
- **Observability:** Sentry (5xx only, prod only) + RequestLog table

## Project Structure

```
src/
├── main.ts                              # Bootstrap + Swagger + middleware
├── app.module.ts                        # Root module
├── core/                                # Infrastructure layer
│   ├── constants/                       # App-wide constants
│   ├── database/                        # Prisma service & module
│   ├── decorators/                      # @CurrentUser, @Public, @Roles
│   ├── filters/                         # Global exception filter
│   ├── guards/                          # JWT auth guard, Roles guard
│   ├── mail/                            # Resend email service + templates
│   └── utils/                           # Helper functions
└── modules/                             # Business domain
    ├── auth/                            # Register, login, verify, refresh, logout
    └── settings/                        # App settings CRUD
```

## API Endpoints

### Auth

| Method | Route                | Auth    | Description                          |
| ------ | -------------------- | ------- | ------------------------------------ |
| POST   | `/auth/register`     | Public  | Register user + send OTP email       |
| POST   | `/auth/verify-email` | Public  | Verify email with 6-digit OTP        |
| POST   | `/auth/login`        | Public  | Login + issue JWT + set cookies      |
| POST   | `/auth/refresh`      | Public  | Rotate refresh token                 |
| POST   | `/auth/logout`       | JWT     | Revoke refresh token + clear cookies |
| GET    | `/auth/me`           | JWT     | Get current user                     |

### Settings

| Method | Route                 | Auth  | Description                   |
| ------ | --------------------- | ----- | ----------------------------- |
| GET    | `/settings/app-info`  | Public| Get app info (name, logo ...) |
| GET    | `/settings/:key`      | Admin | Get setting by key            |
| PUT    | `/settings/:key`      | Admin | Create/update setting by key  |

### Docs

| Method | Route  | Description              |
| ------ | ------ | ------------------------ |
| GET    | `/api` | Swagger UI documentation |

## Getting Started

### Prerequisites

- Node.js >= 18
- Yarn

### Setup

```bash
# Install dependencies
yarn install

# Copy env file and fill in values
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Start dev server
yarn start:dev
```

### Environment Variables

| Variable                       | Description                       |
| ------------------------------ | --------------------------------- |
| `DATABASE_URL`                 | PostgreSQL connection string      |
| `PORT`                         | Server port                       |
| `JWT_SECRET`                   | JWT signing secret                |
| `JWT_ACCESS_TOKEN_EXPIRATION`  | Access token TTL (seconds)        |
| `JWT_REFRESH_TOKEN_EXPIRATION` | Refresh token TTL (seconds)       |
| `TOKEN_VERIFY_EXPIRY`          | Email OTP TTL (seconds)           |
| `CORS_ORIGIN`                  | Allowed CORS origin               |
| `NODE_ENV`                     | `development` / `production`      |
| `RESEND_API_KEY`               | Resend API key for sending emails |

## Database

Prisma multi-file schema in `prisma/`:

```
prisma/
├── base.prisma               # Generator + datasource
├── enums.prisma               # Role enum
├── user.prisma                # User model
├── verification-token.prisma  # Email OTP tokens
├── refresh-token.prisma       # JWT refresh tokens
└── app-settings.prisma        # App settings (key-value JSON)
```

## Author

[phamtanhoang](https://github.com/phamtanhoang)
