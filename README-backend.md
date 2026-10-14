# Amerapelle backend

NestJS 10 + TypeScript + PostgreSQL (Drizzle ORM). Serves the REST API in `docs/api-contract.md` under `/api/v1`, and deploys to Railway.

## Run locally

```bash
cp .env.example .env            # fill in DATABASE_URL, FRONTEND_URL, secrets
npm install
npm run build
npm run migrate                 # applies drizzle/*.sql
npm run seed                    # admin, collections, products from the designs, zones, FAQ, pages, settings
npm run start:dev               # http://localhost:4000/api/v1/health
npm test                        # unit and flow tests (no database needed)
```

When you change `src/db/schema.ts`, run `npm run db:generate` and commit the new file in `drizzle/`.

## Deploy on Railway

1. Add a **Postgres** service. In the backend service, set `DATABASE_URL=${{Postgres.DATABASE_URL}}` and fill in the other variables from `.env.example`. Set `NODE_ENV=production`.
2. Railway builds from the `Dockerfile` (see `railway.json`). Each deploy runs `npm run migrate && npm run start:prod`, and the health check hits `/api/v1/health`.
3. Run the seed once: `railway run npm run seed`.
4. Webhook URLs to register:
   - Paystack: `https://<api>/api/v1/payments/webhooks/paystack`
   - Bachs: `https://<api>/api/v1/payments/webhooks/bachs`
5. Sign in to the admin, then call `POST /admin/auth/totp/setup` and confirm the code with `POST /admin/auth/totp/enable`. After that, every admin login also asks for a TOTP code.

## Architecture

There is one Nest module per domain. Controllers stay thin. Services depend on injection tokens (repository interfaces, `PaymentProvider[]`, `EmailSender`, `Clock`, `StorageSigner` and `ImageUploader`), not on concrete classes. The Drizzle repositories are the only code that touches SQL.

| Module | Responsibility |
| --- | --- |
| `config`, `db`, `common/guards` | Typed environment config, the Drizzle/pg pool, JWT guards, the role guard and `Clock` |
| `settings` | Store settings (jsonb), public settings and the live drop counter |
| `catalogue` | Collections, product listing with filters, facets, `pg_trgm` search with suggestions, PDP, related items, badges, and the inventory snapshots used by the cart and checkout |
| `cart` | Guest carts (`X-Cart-Token`) and user carts, merge on login, promo codes, stock checks |
| `checkout` | Quote and order creation (`PENDING_PAYMENT`, 15-minute stock holds, credit). An order paid fully by credit becomes `PAID` without a provider |
| `payments` | `PaymentProvider` interface with the Paystack and Bachs adapters, a registry that respects the admin toggles, idempotent raw-body webhooks (`webhook_events` is unique on provider + event id), verification and the hold-expiry cron (no refunds — exchange credit only, PAY-7) |
| `orders` | Order presenter, guest lookup, and the lifecycle: paid, cancelled or expired, and admin status changes with emails |
| `exchanges`, `credit` | EXC-1..8: exchange state machine, restocking, and a credit ledger with optional expiry |
| `auth`, `me` | Register and login, rotating `ap_rt` refresh cookie, password reset, profile, addresses, wishlist, credit, NDPA export and delete |
| `content` | FAQ, pages, contact, newsletter, drop notify, delivery zones, `GET /locations/states` |
| `admin` | TOTP sign-in, dashboard, products with the variant matrix, stock CSV, Cloudinary signing, collections, orders with packing slips, exchanges, discounts, zones, settings, FAQ, pages |
| `email` | `EmailSender` (Resend, or console output when `RESEND_API_KEY` is unset) and branded HTML templates |

Money is always stored as integer kobo. Bachs amounts are converted to decimal strings only at the adapter boundary. An order becomes `PAID` only after the server has re-verified the payment with the provider and the amount matches. A browser redirect alone never marks an order paid.
