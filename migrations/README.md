# Booking and upgrade fix — review notes

Not deployed. Apply `20261001_booking_service_and_upgrades.sql` to the booking database before deploying the API and web changes. Back up and verify the existing events/quotes schema first. The migration was tested in an isolated PostgreSQL-compatible PGlite database, not production.

The migration adds service_type (bartending or soda) and an atomic paid-upgrade ledger. Existing records default to bartending; historical soda bookings need manual identification. Premium drink purchases are recorded in paid_upgrades and included in the confirmation copied to Jen and Wayne. Extra hours and bartenders also update the event fields. Paid upgrades increase the total while leaving the existing deposit and balance unchanged.

Deploy API before web. No live Stripe checkout or email delivery has been tested. After release, Wayne should verify a real booking, confirmation delivery, and upgrade fulfillment. The web production build also requires the existing Supabase configuration.

## Local regression check

Run `npm run build`. Install `@electric-sql/pglite` in an isolated temporary directory, then run `NODE_PATH=/path/to/temp/node_modules node tests/booking-upgrades.cjs`.

This uses an in-memory database and a mocked email provider. It checks migration syntax, duplicate sessions, invalid amounts/payment states, unchanged balance/deposit, service persistence, and email errors with stable retry keys. It does not send email or contact Stripe/Supabase. It is not a full webhook/network integration test.

The lockfile was synchronized with the existing TypeScript range so dependencies install and the API compiles. API build, web lint/typecheck, and whitespace checks passed locally.
