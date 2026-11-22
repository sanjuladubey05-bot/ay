# Security Summary

### Overview

- **Application**: LPS STORE Gaming Top-Up Platform (Express API, React/Vite frontend, PostgreSQL/PGlite with Row-Level Security)
- **Files Audited & Hardened**: 24 server, shared utility, database, configuration, and frontend layout files across authentication, storefront checkout, Razorpay payments, media storage, supplier dispatch, and admin operations.
- **Verification Status**: All security hardening changes have been compiled, linted, dependency-audited (`0` known package vulnerabilities across 242 installed packages), and covered by automated unit and integration tests.

### Issues Resolved

| Security Area | Finding | Resolution Applied | Status |
| :--- | :--- | :--- | :--- |
| Secrets & Environment | Unused placeholder key (`GEMINI_API_KEY`) in `.env.example` and environment variable names surfaced in public/admin HTTP error strings | Removed unused placeholder from `.env.example`; replaced raw variable names in `/api/auth/admin/bootstrap`, `/api/payments/webhook`, and live supplier dispatch responses with clean generic messages while keeping credentials strictly server-side | Resolved |
| Authentication & RBAC | Admin overview endpoint returned recent `audit_logs` (including IP addresses) to non-audit admin roles; customer order queries relied solely on session RLS context without an explicit SQL ownership clause | Restricted `recentAuditLogs` in `/api/admin/overview` to admins holding `admin.audit.read` or wildcard permissions; added explicit `WHERE o.customer_id = $1` and `($2::boolean = TRUE OR o.customer_id = $3::uuid)` ownership predicates in `/api/customer/orders` and `/api/payments/status`; enforced game/region/currency active validation in `/api/payments/create-order` | Resolved |
| Input, Injection & XSS | Outbound supplier URLs accepted unverified HTTPS hosts without blocking internal/loopback/metadata IP addresses or DNS rebinding; stored logo/cover/social URLs lacked strict protocol filtering; malformed UUID route parameters could trigger raw SQL cast errors; regex validator needed alternation-quantifier and backreference limits; uploaded file helpers lacked explicit resolved-path confinement | Added `/src/utilities/safeUrl.ts` and `/src/utilities/displayUrl.ts` to block non-HTTPS supplier endpoints, embedded URL credentials, private/loopback/link-local/metadata IPs, DNS-resolved private hosts, redirects (`redirect: 'error'`), and `javascript:`/`data:` URIs in storefront and catalog inputs; added `adminRouter.param` UUID validation across `:id`, `:gameId`, and `:regionId`; validated query strings with Zod schemas; tightened `validateRegexPattern`; added `path.resolve` trailing-separator confinement in `mediaStorage.ts` and `/media/:filename` | Resolved |
| CORS, CSRF, Headers & Rate Limiting | No global API CORS origin allowlist check or security header policy (`CSP`, `X-Content-Type-Options`, `Permissions-Policy`, `Referrer-Policy`, HTTPS `HSTS`); `/payments/webhook` CSRF exemption relied on relative path check; `PATCH /customer/profile`, `/payments/webhook`, `/payments/refund`, and admin media/dispatch routes lacked dedicated rate limits; failed checkout limiter needed clearer coverage | Added strict origin-verified CORS middleware (rejecting untrusted cross-origin requests without wildcard `*`), full HTTP security headers with `x-powered-by` disabled, `Referer` fallback origin checks + `X-Requested-With` enforcement on browser mutations, accurate `/api/payments/webhook` exemption, expired rate-bucket pruning, and dedicated rate limiters on profile updates, webhooks, refunds, media uploads, and supplier dispatches | Resolved |
| Dependencies & Error Handling | Unused `@google/genai` and `autoprefixer` packages plus runtime listing of `@types/pg`; Express 4 async route handlers could leave unhandled rejections without reaching the global error boundary; live supplier catch blocks leaked raw network error strings | Removed unused packages, moved `@types/pg` to `devDependencies`, resynced lockfile and verified clean `bun audit`; wrapped all async route handlers in `asyncHandler`; added clean `413`/`400` JSON body handling and sanitized supplier and global error responses while preserving server-side logs | Resolved |

### Safeguards Verified

| Control Domain | Safeguard Implementation |
| :--- | :--- |
| Session & Credential Storage | `scrypt` per-user salted password hashing, SHA-256 hashed session tokens in `auth_sessions`, `HttpOnly`, `SameSite=Lax`, and conditional `Secure` cookies; zero admin secrets or service-role keys exposed to Vite client bundles |
| Parameterized Queries & RLS | 100% `$1, $2...` parameterized PostgreSQL/PGlite queries (`pool.ts`, `authRoutes.ts`, `customerRoutes.ts`, `paymentRoutes.ts`, `adminRoutes.ts`) paired with transaction-scoped `withUserRlsContext` Row-Level Security policies |
| HTML & URL Sink Hygiene | Zero `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, or shell execution calls in the codebase; strict HTTP(S) / approved `/media/` & `/src/assets/` path checks in both server Zod schemas and frontend rendering helpers |
| Media Upload Integrity | Magic-byte header verification restricted to JPG, PNG, and WebP (5 MB cap), UUID filenames, and resolved-directory confinement |
| Dependency Hygiene | 242 packages checked via `bun audit` with zero known vulnerabilities |

## PoC Verification

Each scenario below documents the verified control behavior confirmed via automated HTTP integration tests against the running Express application (`src/api/security_and_blueprint.test.ts` and `src/api/api.test.ts`).

### 1. Outbound Supplier Endpoint Restrictions (Blocking Internal & Cleartext Targets)

- **Scenario**: An authenticated administrator submits `POST /api/admin/suppliers` in `live` mode with internal, loopback, metadata, credential-embedded, or plain `http://` URLs (`https://127.0.0.1/admin`, `https://169.254.169.254/latest/meta-data`, `https://localhost/internal`, `https://user:pass@supplier.example/api`, `http://api.supplier.example`).
- **Hardened Behavior**: Validation rejects every request with `400 VALIDATION_ERROR` before persistence, and `executeSupplierRequest` re-resolves DNS records via `assertPublicSupplierEndpoint` immediately prior to outbound `fetch(..., { redirect: 'error' })`, aborting if any resolved A/AAAA address falls within private, loopback, link-local, or cloud metadata ranges.

### 2. Stored URL Sanitization Against Script Schemes

- **Scenario**: Submitting `storeLogoUrl: "javascript:alert(1)"` or `socialLinks.instagram: "javascript:alert(2)"` to `PATCH /api/admin/website-settings`, or `coverImageUrl: "javascript:alert(1)"` to `POST /api/admin/catalog/games`.
- **Hardened Behavior**: Server-side Zod validation (`safeMediaUrlSchema` and `safeExternalLinkSchema`) rejects all payloads with `400 VALIDATION_ERROR`, while frontend `sanitizeMediaSrc` and `sanitizeExternalHref` strip any non-HTTP(S) or invalid relative path before rendering `<a>` or `<img>` tags.

### 3. Ownership Isolation & Checkout Rate Limiting

- **Scenario**: Customer B calls `GET /api/customer/orders` and `GET /api/payments/status?orderId=<Customer A orderId>`; additionally, an automated script submits 6 invalid checkout requests (`POST /api/orders/place`) within 60 seconds.
- **Hardened Behavior**: Customer B receives an empty order array (`[]`) and `404 NOT_FOUND` on payment status due to explicit `customer_id` SQL filters layered with database RLS policies. After 5 failed checkout attempts from the same IP within 1 minute, the 6th checkout attempt is blocked with HTTP `429 FAILED_CHECKOUT_RATE_LIMITED` and a `Retry-After` header.

### 4. Parameter Validation & Safe Error Boundary

- **Scenario**: Sending a malformed non-UUID identifier to `GET /api/admin/orders/not-a-uuid` or `GET /api/payments/status?orderId=not-a-uuid`.
- **Hardened Behavior**: `adminRouter.param` and `paymentStatusQuerySchema` reject invalid identifiers immediately with `400 VALIDATION_ERROR` (`"Invalid resource identifier."`), preventing database UUID cast exceptions, stack traces, or internal SQL messages from reaching clients.

### 5. Cross-Origin Policy, CSRF Verification & Role-Scoped Overview Data

- **Scenario**: Issuing an API request with an untrusted `Origin: https://evil-attacker.example`, issuing an authenticated cookie `POST` without `X-Requested-With: LPS-Store-Client`, and querying `GET /api/admin/overview` as a `support` role admin lacking `admin.audit.read`.
- **Hardened Behavior**: The untrusted cross-origin request returns `403 CORS_ORIGIN_DENIED` with no wildcard `Access-Control-Allow-Origin` header; the missing custom header mutation returns `403 CSRF_HEADER_MISSING`; and the `support` admin receives dashboard summaries with `recentAuditLogs: []` instead of IP-bearing audit records.
