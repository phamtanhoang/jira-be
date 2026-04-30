# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email `security@example.com` (replace with your real address) with:

- A description of the issue and its impact
- Steps to reproduce (curl commands, payloads, screenshots)
- Affected version / commit SHA if known
- Your name / handle for credit (optional)

We will acknowledge within **3 business days** and provide a remediation timeline within 7 days. Critical issues (auth bypass, RCE, data exfiltration) are prioritized.

Please give us a reasonable window to ship a fix before public disclosure (we aim for 30 days; longer if the fix requires architectural changes).

## Scope

In-scope:

- Authentication / authorization bypass (JWT, session, role)
- SQL / Prisma injection
- XSS in any user-controlled rendered HTML (issue description, comments, mentions)
- CSRF on state-changing endpoints
- Privilege escalation (workspace member → admin, user → ADMIN role)
- Sensitive data leakage (passwords, tokens, OAuth secrets, OTP, API keys, refresh tokens)
- Webhook signature bypass
- Rate limit bypass on auth/upload endpoints

Out of scope:

- DoS via legitimate API floods (we use throttling; report new bypasses, not "I sent 1000 requests")
- Issues in third-party dependencies — please report upstream first; we'll bump versions when patched
- Social engineering of project maintainers
- Self-XSS / CSP bypass requiring local file access

## Hardening already in place

- JWT in `httpOnly`, `secure`, `sameSite` cookies — never localStorage
- bcrypt 12 rounds for password hashing
- Helmet headers (X-Frame-Options DENY, HSTS in production)
- Per-route throttling (auth 3-5/min, upload 10/min, login attempts limited)
- DTO validation via `class-validator` with `whitelist + forbidNonWhitelisted`
- Sanitize-html on rich text (Tiptap output) before persistence
- Sensitive fields (`password`, `otp`, `token`, etc.) recursively masked from RequestLog and breadcrumbs — see `src/core/utils/sanitize.util.ts`
- Sentry only sees 5xx (4xx stays in DB) — minimizes leak surface to upstream
- Webhook payloads signed with HMAC-SHA256 + per-webhook secret
- Share tokens are random + revocable + view-counted
- Soft privacy boundary: `/users/:id/profile` 404s for users outside shared workspaces (no role disclosure)

## Disclosure log

(intentionally blank — no public CVEs at this time)
