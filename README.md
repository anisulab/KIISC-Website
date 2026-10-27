# Knowledge Inn International School and College: Website & School Management System

React + TypeScript + Tailwind frontend, with a Lovable Cloud (Supabase/PostgreSQL) backend.

- Plan, architecture, permission matrix and roadmap: [docs/PLANNING.md](docs/PLANNING.md)
- Before going live: [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) · Backups and restore drill: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- Current stage: **Stage 10 complete — all planned stages delivered.** Next: the go-live steps in the production checklist.
  - Stage 10: **two-step verification (MFA)** for staff, enforced by the database once switched on in **Admin → Security**; CAPTCHA widget on the admission form; 30-minute idle sign-out on staff and teacher screens; report export rate limit; integrity report and record counts for backup/restore drills; tightened database grants checked by an automated security lint.
  - Stage 9: **Reports & exports** at `/admin/reports` (student list, admissions, attendance summary, frequent absences, tabulation sheet, fee collections, outstanding dues): run on screen, download as CSV (opens correctly in Excel, including Bengali), or print / save as PDF on A4 with the school letterhead. Every report run is permission-checked on the server and written to the audit log. Teachers can download CSVs for their own sections. **Email notifications** at `/admin/notifications` (admission updates, results published, payment receipts, absence alerts, fee reminders), all off until switched on; parents can opt out under "My account".
  - Stage 8: **family portal** at `/portal` for students and parents (overview, timetable, attendance, published results & report cards, fees & receipts, learning resources). Admin: bell schedule & class timetables (`/admin/timetable`), learning resources (`/admin/resources`), parent link requests (`/admin/link-requests`), and a "Portal account" panel on each student/guardian. Teachers see their timetable and add resources from `/teacher`.
  - Stage 7: fees & finance at `/admin/finance/*` — fee categories and class-wise fees, discounts, bulk invoice generation (never bills twice), payments (cash / bank / mobile banking) with receipts, duplicate-payment protection, reversals and adjustments instead of deletions, late fees, collection and outstanding reports.
  - Stage 6: grading schemes (`/admin/grading`), examinations (`/admin/exams`) with subjects per class/stream, marks entry by subject teachers (teacher portal → Examinations), review → approval (principal) → publication, marks corrections, server-calculated results (total, %, GPA, grade, merit position) and printable bilingual report cards.
  - Stage 5: teachers & teaching assignments (`/admin/teachers`), daily attendance with holidays, weekly off-days and a teacher edit window, correction requests approved by someone else, attendance reports, and the **teacher portal** at `/teacher`.
  - Stage 4: students & guardians at `/admin/students` (student IDs and admission numbers, per-year enrollment history, verified guardian links, documents, transfer/withdrawal), "Admit as student" from approved applications, year-end promotion at `/admin/promotion`.
  - Stage 1: bilingual public website, sign-in, roles, RLS, audit log, public content tables.
  - Stage 2: admin console at `/admin` (dashboard, notices/events/gallery/documents manager with uploads, users & roles, institution settings, audit log, my account).
  - Stage 3: academic setup (years, terms, classes per stream, sections, subjects, curriculum), online admission form at `/admissions/apply`, private status check at `/admissions/status`, admission office workflow at `/admin/admissions`.

## Sample data

The website can be filled with **clearly labelled sample data** (classes, subjects, sections, document types, admission settings, six sample students marked `SAMPLE RECORD`, a few `[Sample]` notices and events) so everything can be explored before the school's real information is ready.

- Load: run [supabase/seed/sample_data.sql](supabase/seed/sample_data.sql) once in the Cloud SQL editor (after the migrations).
- Edit: change anything through the admin console. Edited records become your real data.
- Remove: run [supabase/seed/remove_sample_data.sql](supabase/seed/remove_sample_data.sql). It deletes only sample rows that are still unchanged, and stops safely if a real application uses a sample class or year.

Sample data is never part of the migrations, so a fresh production database starts empty.

## Email notifications (setup)

Nothing is emailed until all of the following are done:

1. Create an account at [Resend](https://resend.com) and verify the school's sending domain (or use their test sender while trying it out).
2. In Lovable Cloud → Secrets, add:
   - `RESEND_API_KEY`: the API key from Resend.
   - `EMAIL_FROM`: e.g. `Knowledge Inn <noreply@your-domain>`.
   - `SITE_URL`: the public website address (`https://…`), used for "Sign in" links in emails. Optional.
   - `NOTIFY_CRON_SECRET`: a long random string. Needed only for the automatic schedule in step 4.
3. Deploy the `send-notifications` edge function, then switch on the emails you want under **Admin → Email notifications**. **Send queued emails now** sends immediately.
4. Optional, for automatic sending every 5 minutes: if the `pg_cron` and `pg_net` extensions are enabled, run this once in the SQL editor (replace both placeholders):

```sql
select cron.schedule('send-notifications', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<NOTIFY_CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);
```

How it works:
- Messages are queued by the database and sent by the edge function. The Resend key never reaches the browser.
- Results emails never contain marks. Absence alerts wait 30 minutes and are not sent if the teacher corrects the record.
- Messages older than 3 days are not sent. Sent and skipped messages are deleted after 180 days.

## Giving students and parents portal access

1. Create the account in **Users** with the `student` or `guardian` role.
2. Open the student in **Students** and use **Portal account** (for the student) or the button on the guardian card to link that account. The guardian link must be verified.
3. A parent who already has an account can also send a request from `/portal` (student ID + their mobile number). Staff review it under **Parent link requests**. It can only be approved if the mobile number matches a guardian the school already has on record. Entering a student ID never grants access by itself.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in values (see below), or leave empty to run without a backend
npm run dev                  # http://localhost:8080
npm run build                # type-check + production build (+ sitemap if VITE_SITE_URL is set)
npm run test:db              # database security tests (PGlite, no Docker needed)
npm run test:unit            # CSV export and email template tests
```

The site runs without a backend. Database-driven sections (notices, events, gallery, documents) then show a "Content service not connected" state. Nothing is faked.

## Moving the project into Lovable (with Lovable Cloud)

Lovable creates projects from its own repository, so the usual path is:

1. In Lovable, create a new project and **connect GitHub** (Settings → GitHub). Lovable creates a repository.
2. Clone that repository, copy this project's files into it (replacing Lovable's starter files), commit and push. Lovable syncs from GitHub.
3. In Lovable, **enable Lovable Cloud**. It sets `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PROJECT_ID`, and may regenerate `src/integrations/supabase/client.ts`. That is fine as long as it still exports `supabase`.
4. Apply the migrations in [supabase/migrations](supabase/migrations) in filename order (ask Lovable to run them, or paste them into the Cloud SQL editor).
5. In Cloud → Auth settings: **disable public sign-ups**. Accounts are created by administrators. Add your site URL and `/reset-password` to the allowed redirect URLs.
6. Deploy the edge functions in [supabase/functions](supabase/functions) (Lovable deploys them automatically). They use the platform-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` secrets.
   - `admin-users`: adding users, activating/deactivating accounts, reset emails.
   - `submit-application`: the public admission form (rate-limited, checks real file types, stores documents in the private `admission-documents` bucket). Optional: set `TURNSTILE_SECRET_KEY` (server secret) and `VITE_TURNSTILE_SITE_KEY` (public site key) to require a Cloudflare Turnstile CAPTCHA on the form.
7. Supabase's built-in email sender has a low hourly limit. Before inviting many staff, configure a custom SMTP provider in Cloud → Auth → SMTP.

## Creating the first Super Administrator

1. Create the user in Cloud → Users (Add user, with email + password).
2. Run once in the SQL editor (it runs as the database owner):

```sql
insert into public.role_assignments (user_id, role)
select id, 'super_admin' from auth.users where email = 'principal@example.com';
```

All later role changes go through the admin console (Stage 2). A super admin can never change their own roles.

## Database tests

Security tests live in [supabase/tests](supabase/tests) and check both allowed and denied access for each role.

**Without Docker** (runs anywhere Node runs, used during development):

```bash
npm run test:db
```

This starts an in-memory PostgreSQL (PGlite) for each test file, loads a small stand-in for Supabase's `auth`/`storage` schemas ([scripts/db-test-support](scripts/db-test-support)), applies every migration in order, and runs the tests.

**Against the real Supabase stack** (Supabase CLI + Docker, uses real pgTAP):

```bash
supabase start
supabase db reset     # applies migrations
supabase test db
```

## Security notes

- Only publishable values use the `VITE_` prefix. Service-role keys, email and payment secrets belong in backend secrets only.
- Roles are read from `public.role_assignments`, never from JWT or user metadata.
- Notice and event text is rendered as plain text (no HTML) to prevent XSS.
- Confidential files must never go into the `public-assets` bucket. A private bucket with signed URLs arrives with admissions (Stage 3).

## Backups (summary)

Lovable Cloud / Supabase projects include automatic daily backups on paid plans. Before production, also:
- schedule a weekly `pg_dump` export stored outside the platform;
- perform and document a test restore into a separate project;
- export Storage buckets periodically.

Full deployment, backup/restore and production-readiness documents are delivered in Stage 10.
