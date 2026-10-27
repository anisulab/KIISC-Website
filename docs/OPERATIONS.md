# Operations: backups, restore drill, incidents

Written for the person who looks after the school system (the super administrator or an IT helper). Plain steps; no step deletes data.

## 1. What must be backed up

| What | Where | Why |
|---|---|---|
| Database | Lovable Cloud (Supabase PostgreSQL) | All records: students, attendance, marks, invoices, payments, audit log |
| Private files | Storage buckets `student-documents`, `admission-documents`, `learning-resources` | Uploaded certificates, photos, worksheets |
| Public files | Storage bucket `public-assets` | Logo, notice attachments, gallery photos |
| Secrets | Lovable Cloud → Secrets | `RESEND_API_KEY`, `EMAIL_FROM`, `TURNSTILE_SECRET_KEY`, `NOTIFY_CRON_SECRET` (store a copy in a password manager, never in a document) |
| Code | GitHub repository connected to Lovable | Already versioned |

## 2. Backups

1. **Platform backups.** Check in Lovable Cloud (or with Lovable support) which automatic database backups your plan includes, how many days they are kept, and how a restore is requested. Write the answer here:
   - Automatic backups: _to be confirmed_
   - Kept for: _to be confirmed_
   - Restore requested by: _to be confirmed_
2. **Your own monthly copy.** Platform backups belong to the same provider, so keep an extra copy under the school's control.
   - **If you have the database connection string** (Lovable Cloud may provide it, or you may run your own Supabase project): on a trusted computer with PostgreSQL client tools, run:
     ```bash
     pg_dump "$DATABASE_URL" --format=custom --no-owner --file="kiisc-$(date +%F).dump"
     ```
     Keep the connection string in a password manager. Never put it in the code, a chat or an email.
   - **Files:** download the storage buckets from the dashboard (or with a tool you have tested) into a dated folder.
   - **Store the copy encrypted**, for example in an encrypted archive on an external drive kept in the office safe, and keep the last 12 monthly copies. These files contain children's personal data.
3. **Paper trail.** Before each copy, open **Admin → Security → Run checks** and save a screenshot of the record counts. You will compare against it after a restore.

## 3. Restore drill (every 6 months)

Practise on a **separate, empty test project**. Never restore over the live system.

1. Create a new, empty Supabase/Lovable Cloud project for the drill.
2. Restore the latest database copy into it:
   ```bash
   pg_restore --no-owner --dbname="$TEST_DATABASE_URL" kiisc-YYYY-MM-DD.dump
   ```
   Then upload the saved files into the same bucket names.
3. In the test project's SQL editor run:
   ```sql
   select * from public.integrity_report();  -- every "problems" value must be 0
   select * from public.data_fingerprint();  -- must match the screenshot taken before the backup
   ```
   `*_files_missing` checks above 0 mean the files were not restored. Other problems mean the copy is incomplete.
4. Sign in to the test project's site with a test account and open one student, one report card and one receipt.
5. Write the date, who did the drill, how long it took and any problems in the log below. Then delete the test project.

| Date | By | Duration | Result / problems |
|---|---|---|---|
| | | | |

## 4. When something goes wrong

- **A staff member lost their phone (two-step verification):**
  - A super administrator removes that person's authenticator factor in Lovable Cloud → Authentication → Users.
  - The person then sets up a new one at their next sign-in.
  - Check **Admin → Audit log** for unusual activity by that account.
- **Suspected account misuse:**
  - Deactivate the account in **Admin → Users & roles**. This blocks sign-in and all data access at once.
  - Review the audit log, including report exports.
- **The only super administrator is locked out:** in the SQL editor (database owner):
  ```sql
  update public.security_settings set require_staff_mfa = false;  -- temporary
  ```
  Then let them sign in and set up a new authenticator, and switch the requirement on again from **Admin → Security**.
- **Wrong data entered:** never delete records. Use the built-in corrections: payment reversal, invoice adjustment, marks or attendance correction requests. Each keeps history.
- **A data breach:** stop the cause first (deactivate accounts, rotate the exposed key in Lovable Cloud → Secrets). Record what happened and when. Inform the school management promptly, and take legal advice on any duty to notify affected families or authorities.
