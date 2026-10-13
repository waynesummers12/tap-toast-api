# Signed agreement imports

## Admin flow

On `/dashboard`, expand **Upload Agreement**, choose a PDF or `.docx` (10 MB maximum, 30 PDF pages maximum), review the suggested details, confirm payment status, then select **Add Event to Dashboard**. The original file is kept in private storage and can be downloaded from the event details. The **Drinks Serving** column is editable in the details panel for both imported and existing events.

Extraction reads labelled fields, such as `Client Name:`, `Event Date:`, `Total Price:`, and `Drinks Serving:`. It does not use an AI service. Unlabelled prose, handwriting, and scanned images aren't automatically understood. Scanned PDFs can still be attached with manual field entry. The parser does not determine whether a signature is legally valid. No actual customer agreement was available for testing; sample PDFs and Word documents were used.

The import does not send email, charge a customer, or infer that a deposit was paid. Imported records start with `event_status = imported`, so the existing automatic reminder worker (which selects `confirmed`) won't contact them merely because they were imported. Explicit admin payment actions still work; subsequent Stripe payment confirmation can move an event to `confirmed` as usual. Existing customer records are reused by email, never overwritten. `balance_due` retains the existing application's meaning: the amount due after the agreed deposit, or zero if fully paid.

Importing the exact same file returns its existing agreement/event, including a cancelled event. Two different documents for the same customer/date trigger a review warning; an admin can explicitly confirm a distinct event. Event creation, customer creation, and linking the agreement happen in a single database transaction. Abandoned review drafts retain their private file and can be resumed by uploading the same file again.

## Deployment order

1. Apply `supabase/migrations/20261013182533_signed_agreement_imports.sql` to the existing Tap & Toast Supabase project. It adds the nullable drink-menu column, a restricted agreement table, a private bucket, and a service-role-only transaction function. Existing events are not rewritten.
2. Deploy the API, including the earlier cancellation endpoint consolidation. It requires the existing Supabase service key and `TAP_TOAST_ADMIN_EMAILS`; no new API key or external extraction service is needed.
3. Deploy the website. A local web preview connected to the old production API cannot upload agreements or save drinks until step 2 completes.
4. Wayne/Jen can test with an actual signed agreement, check every extracted field, and confirm the imported event appears and its attachment downloads. Do not automatically submit a real contract during deployment verification.

All agreement endpoints pass through the existing admin-email allowlist. Files are never publicly listed. Download links expire after five minutes. The bucket has no anonymous/authenticated storage policy; only the admin API's server-side service key can read or upload files. Postgres grants for the agreement table and import function are restricted to `service_role` and RLS is enabled. Keep the bucket private and do not add broad storage policies.

## Verification

Run `npm run build`. Install `@electric-sql/pglite`, `pdfkit`, and `jszip` in an isolated test directory, then use its node_modules path:

```
NODE_PATH=/path/to/test/node_modules node tests/agreement-imports.cjs
NODE_PATH=/path/to/test/node_modules node tests/agreement-routes.cjs
```

These use an isolated database and mocked accounts/storage. They cover real PDF/Word text extraction, scanned-PDF fallback, invalid fields, failed/oversized uploads, admin-only access, duplicate uploads/imports, totals, and private download links. They do not send emails or call Stripe or production Supabase.

Frontend checks: TypeScript and ESLint on the dashboard and its new components. The local Chrome dashboard showed the new section and column. The live upload/storage round trip awaits deployment.

Dependency audit: the new archive reader uses patched yauzl 3.4.0. npm also reports existing API dependency advisories and an unpatched sprintf-js advisory through Mammoth's argparse CLI dependency; this application calls Mammoth's raw-text API, not its CLI or user-controlled sprintf formatting. Those broader dependency upgrades are outside this feature.

## October 13 release

The agreement migration and `20261013190206_protect_server_managed_records.sql` were applied to production Supabase before publishing the API. The second migration enables RLS on the older server-managed tables; the existing API service role retains access, while browser database roles have no direct row access. Auth continues to use the public client as before.
