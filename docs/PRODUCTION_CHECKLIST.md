# Production checklist

Tick every item before the site is announced to parents. Items marked **(school)** need information or a decision from the school; the rest are technical.

## Data and content
- [ ] **(school)** Confirm and enter the real institutional facts in **Admin → Institution settings**: EIIN, establishment year, board affiliation, office hours, logo. None of these were invented; empty fields stay hidden.
- [ ] **(school)** Review the Bengali translations of the About, Mission and Vision text.
- [ ] **(school)** Replace or remove the sample data:
  - Enter the real classes, sections, subjects, fees, grading scheme and teachers.
  - Run [supabase/seed/remove_sample_data.sql](../supabase/seed/remove_sample_data.sql). It removes only sample rows nobody has edited.
- [ ] **(school)** Have the Privacy and Terms pages reviewed by someone qualified. The system does not claim legal compliance.
- [ ] **(school)** Check that teachers listed on the public Faculty page have agreed to it (`show_on_website`).

## Accounts and sign-in (Lovable Cloud → Authentication)
- [ ] Public sign-ups **disabled**. Accounts are created by administrators.
- [ ] Site URL and `/reset-password` set as allowed redirect URLs.
- [ ] Minimum password length at least 10, and leaked-password protection on, if your plan offers it.
- [ ] **MFA (TOTP) enabled** for the project.
- [ ] Custom SMTP configured for sign-in emails (the built-in sender has a low hourly limit).
- [ ] At least **two** super administrator accounts held by different trusted people, both with an authenticator app.
- [ ] Every staff member has set up two-step verification. Then switch on **Admin → Security → Require for all staff**.
- [ ] Remove test accounts. Review **Admin → Users & roles** for anyone with more access than their job needs.

## Backend
- [ ] All migrations in [supabase/migrations](../supabase/migrations) applied in filename order.
- [ ] `npm run test:db` passes. It runs 353 database security checks, including the schema-wide security lint.
- [ ] Edge functions deployed: `admin-users`, `submit-application`, `send-notifications`.
- [ ] Secrets set: `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`, `NOTIFY_CRON_SECRET`. No secret appears in the code, `.env` files in the repository, or `VITE_` variables.
- [ ] Frontend variable `VITE_TURNSTILE_SITE_KEY` set (public site key), so the admission form shows the CAPTCHA.
- [ ] Email: sending domain verified in Resend, a test email received, the emails the school wants switched on in **Admin → Email notifications**, and the schedule from README set up.
- [ ] **Admin → Security → Run checks** shows OK everywhere.

## Hosting
- [ ] Custom domain with HTTPS. `VITE_SITE_URL` set so the sitemap and email links use it.
- [ ] If the host allows response headers, add:
  - `Strict-Transport-Security: max-age=31536000`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `X-Frame-Options: DENY`

  A Content-Security-Policy was left out on purpose: Lovable's editor injects scripts that a strict policy would block. Add one only on a host you control, and test every page afterwards.

## Operations
- [ ] Backup arrangement confirmed and written into [OPERATIONS.md](OPERATIONS.md), and the first own copy made.
- [ ] First restore drill done and logged.
- [ ] Someone is named to read **Admin → Audit log** weekly and check the email log for failures.

## Known limits (tell the school)
- PDFs are made with the browser's "Save as PDF". This is the reliable way to print Bengali text correctly.
- No online payment gateway is connected. Payments are recorded by accounts staff. A gateway can be added later with server-side verification.
- Idle sign-out (30 minutes) runs in the browser. Supabase session lifetime settings, if your plan has them, add a server-side limit.
