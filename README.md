# Jira Clone - Backend API

NestJS backend for a Jira-like project management tool.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** NestJS
- **Database:** PostgreSQL (Neon) + Prisma ORM
- **Auth:** JWT + Passport (httpOnly cookies)
- **Email:** Resend
- **Docs:** Swagger (auto-generated)

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
