# Knowledge Inn SMS: Architecture & Implementation Plan

Status: Stages 1–10 delivered (public website, admin console, academics, admissions, students, attendance, examinations, finance, student & parent portals, reports/exports/PDF printing/email notifications, hardening). Going live follows [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md). Sample data (supabase/seed) stands in for institutional facts until they are confirmed.

## 1. Sitemap

**Public (indexed)**
`/` Home · `/about` · `/mission-vision` · `/faculty` · `/faq` · `/academics` · `/academics/bangla-medium` · `/academics/english-version` · `/examinations` · `/academic-calendar` · `/resources` · `/admissions` · `/admissions/requirements` · `/admissions/apply` *(Stage 3)* · `/admissions/status` *(Stage 3)* · `/notices` · `/notices/:id` · `/events` · `/gallery` · `/contact` · `/privacy` · `/terms` · `*` 404

**Authentication (noindex)**
`/login` · `/reset-password` · `/portal` (role router)

**Admin console `/admin/*`** *(Stage 2+)*
dashboard · settings · users-roles · academic-years · streams-classes-sections · subjects · teachers · timetables · admissions · students · guardians · attendance · examinations · results · finance (fee-structures, invoices, payments, receipts, reports) · content (notices, events, gallery, documents) · reports · audit-log

**Teacher `/teacher/*`**: classes · timetable · attendance · marks · resources · students
**Student `/student/*`**: profile · timetable · attendance · results · resources · fees · notices
**Parent `/parent/*`**: children · attendance · results · invoices · notices · calendar · resources

## 2. Architecture

```
Browser (React + TS + Tailwind, Vite)
  ├─ Public site ── anon key ──┐
  └─ Portals (auth session) ───┤
                               ▼
              Lovable Cloud (Supabase)
  ┌──────────────────────────────────────────────┐
  │ Auth (email/password, reset, MFA for staff)   │
  │ PostgREST API ── RLS on every table ──┐       │
  │ PostgreSQL: schema, constraints,      │       │
  │   SECURITY DEFINER RPCs for multi-    │       │
  │   step transactions, audit triggers   │       │
  │ Edge Functions: admission submit,     │       │
  │   reference numbers, PDFs, exports,   │       │
  │   email, payment callbacks            │       │
  │ Storage: public-assets (public)       │       │
  │          private-documents (signed)   │       │
  └──────────────────────────────────────────────┘
```

Principles: the browser holds only the publishable key. Authorisation lives in RLS and in server functions. Roles are read from `role_assignments`, never from JWT or user metadata. Business calculations (results, balances) run in SQL/RPC. Any operation that writes several rows runs in one database transaction.

## 3. Database relationship plan

| Domain | Tables | Key relationships |
|---|---|---|
| Institution | institution_settings, academic_years, academic_terms, holidays, system_settings | terms → years |
| Auth | user_profiles, role_assignments, audit_logs | profiles 1:1 auth.users; roles N:1 profiles |
| Structure | education_streams, classes, sections, subjects, class_subjects, teacher_assignments, timetables, academic_calendars | class → stream; section → class+year; class_subject → class+subject+stream; teacher_assignment → teacher+section+subject+year |
| Students | students, guardians, student_guardians, student_documents, student_enrollments | enrollment → student+section+year (history kept, never overwritten); student_guardians has `verified_at/verified_by` |
| Admissions | admission_applications, application_documents, admission_status_history | application → student (nullable, unique) prevents duplicate conversion |
| Attendance | attendance_sessions, attendance_records, attendance_correction_requests | session unique(section, date, period); record unique(session, student) |
| Exams | examinations, examination_subjects, grading_schemes, grade_rules, student_marks, result_publications, report_cards | marks unique(exam_subject, student); check `marks <= max_marks` |
| Finance | fee_categories, fee_structures, student_invoices, invoice_items, payments, payment_allocations, discounts_and_waivers, receipts, financial_adjustments | append-only; corrections via reversal rows; payments unique(method, reference) |
| Comms | notices, events, announcements, notification_preferences, notification_logs | targeting by stream/class |
| Resources | learning_resources, gallery_items, downloadable_documents | learning_resources → class_subject (private) |

Human-readable numbers (admission no., student ID, invoice no., receipt no.) come from per-year Postgres sequences inside SECURITY DEFINER functions, e.g. `KI-ADM-2027-000123`. The database also enforces them with `UNIQUE`.

## 4. Role and permission matrix

| Capability | Super | School admin | Principal | Accounts | Admission | Teacher | Student | Parent |
|---|---|---|---|---|---|---|---|---|
| Institution settings | ✔ | read | read | n/a | n/a | n/a | n/a | n/a |
| Grant/revoke roles | ✔ (not self) | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Deactivate accounts | ✔ | ✔ (not super admins) | n/a | n/a | n/a | n/a | n/a | n/a |
| Audit log | ✔ | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Notices/events/gallery | ✔ | ✔ | read | n/a | admission notices *(S3)* | read | read | read |
| Classes/subjects/assignments | ✔ | ✔ | read | n/a | n/a | own | n/a | n/a |
| Admissions | read | ✔ | read | n/a | ✔ | n/a | n/a | n/a |
| Student records | read | ✔ | read | billing fields | applicants | assigned sections (minimal) | own | linked children |
| Attendance | read | ✔ | read | n/a | n/a | assigned sections | own | linked children |
| Marks entry | n/a | n/a | review | n/a | n/a | assigned subjects | n/a | n/a |
| Approve/publish results | n/a | n/a | ✔ | n/a | n/a | n/a | published own | published, linked |
| Fees/invoices/payments | read | read | read | ✔ | n/a | n/a | own | linked children |
| Reports/exports | ✔ | ✔ | academic | financial | admissions | own classes | n/a | n/a |

## 5. Module dependencies

```
Foundation (auth, roles, settings, audit, content)        ← Stage 1 ✔
   └─ Admin shell + user/role management + CMS UI          ← Stage 2 ✔
        └─ Academic structure (years, streams, classes, subjects)  ← Stage 3a ✔
             ├─ Admissions (needs classes/streams, private storage) ← Stage 3b ✔
             │    └─ Students & guardians (conversion, links)      ← Stage 4 ✔
             │         ├─ Attendance (needs enrollments, teacher assignments) ← Stage 5 ✔
             │         ├─ Examinations & results                   ← Stage 6 ✔
             │         └─ Finance (needs enrollments)              ← Stage 7 ✔
             │              └─ Parent / student portals            ← Stage 8 ✔
             └─ Teacher portal                                     ← Stage 5/6
Reports, exports, notifications, PDFs                               ← Stage 9 ✔
Hardening, backups, production checklist                            ← Stage 10 ✔
```

## 6. Implementation sequence

1. **Foundation + public website** ✔: bilingual UI, design system, all public pages, SEO, auth sign-in/reset, roles, RLS, audit, public storage, pgTAP tests.
2. **Admin console** ✔: role-guarded layout, dashboard (real counts only, empty states), user and role management through the `admin-users` edge function (service key server-side only), settings editor with logo upload, CMS for notices, events, gallery and documents with uploads, audit log viewer, account page. 36 database tests run via `npm run test:db`.
3. **Academic structure + admissions** ✔: years/terms, streams, classes (offered per stream), sections, subjects, per-stream curriculum; public application form via the `submit-application` edge function (server validation, IP rate limit, file-type sniffing, private uploads, sequential reference numbers, duplicate prevention, optional CAPTCHA); officer workflow with enforced transitions and status history; private status lookup (reference + guardian phone + date of birth, rate-limited). Email notifications move to Stage 9. 79 database checks.
4. **Students & guardians** ✔: idempotent `admit_applicant` (unique `students.application_id` + row lock), `create_student` for existing students, generated student IDs (KI20270001) and admission numbers (KI-ADM-2027-00001), per-year `student_enrollments` that are never overwritten, guardian reuse for siblings, links unverified until staff verify, transfer/withdrawal/graduation via `change_student_status`, bulk `promote_students`, private `student-documents` bucket. Portal visibility for verified guardians and students is already enforced in RLS. 117 database checks.
5. **Attendance + teacher portal** ✔: teachers (staff codes, optional public listing with consent), class/subject teacher assignments validated against the curriculum, one sheet per section per day, class teacher records within a configurable edit window (Bangladesh time), holidays & weekly off-days, corrections approved by the principal/admin (never by the requester), minimal roster for teachers (no full student records), section/absence/overview reports. 156 database checks.
6. **Examinations & results** ✔: configurable grading schemes (non-overlapping bands, grade points, GPA or percentage method, fail-any-subject rule), exams per year/term with per-class/stream subjects, configurable absent policy, subject-teacher marks entry with server validation (0..full, 2 decimals), workflow draft → marks entry → review → approved (principal) → published with history, marks corrections approved by someone else, results and report cards calculated on the server; students/guardians see only published, own results. 198 database checks.
7. **Finance** ✔: fee categories and year/class/stream fee structures with late fees, approved discounts applied at billing, idempotent bulk invoicing (unique per student+fee+period), payments with idempotency keys and unique transaction IDs, automatic oldest-first allocation, overpayment blocked, reversals/cancellations/adjustments instead of deletes, collection & outstanding reports, minimal `finance_students` directory for accounts staff. Online gateway (with server-side verification) is a later option. 240 database checks.
8. **Student & parent portals** ✔: family portal at `/portal` (children list, per-child overview, timetable, attendance by month, published results and report cards, fees and receipts, learning resources), bell schedule and per-section weekly timetables with teacher-clash and curriculum checks, learning resources (private bucket or https link, teachers only for sections they teach), parent link requests checked by staff against the guardian phone on record, portal-account linking for students and guardians. 267 database checks.
9. **Reports, CSV exports, Bengali PDFs, email notifications** ✔:
   - **Reports:** a single audited `export_report` RPC serves seven reports, reusing each on-screen report's permission check. Teachers can export only the sections they teach.
   - **CSV:** UTF-8 with BOM, CRLF line endings, and protection against formula injection.
   - **PDFs:** produced by the browser's print / "Save as PDF" on A4 pages, landscape for wide reports, with the school letterhead. Server-side PDF libraries do not shape Bengali conjuncts correctly, so the browser does the text rendering.
   - **Email:**
     - A trigger-fed outbox with per-event switches (all off by default), de-duplication keys and parent opt-out.
     - Sent by the `send-notifications` edge function through Resend, with idempotency keys, retries with back-off, a 3-day expiry and 180-day retention.
   - 317 database checks and 14 unit tests.
10. **Hardening** ✔:
    - **Staff MFA (TOTP):** `has_role` counts staff roles only in aal2 sessions once the policy is on. It can only be switched on from an aal2 session, so the person enabling it cannot lock themselves out. A rollout view shows who has MFA.
    - **Admission form:** Turnstile CAPTCHA widget.
    - **Idle sign-out:** after 30 minutes on staff and teacher screens.
    - **Export limit:** 120 report runs per user per hour.
    - **Backup support:** `integrity_report()` and `data_fingerprint()` for restore drills.
    - **Tighter grants:** TRUNCATE and unneeded anonymous rights revoked.
    - **Schema-wide security lint** run with the tests.
    - **Docs:** [OPERATIONS.md](OPERATIONS.md) and [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md).
    - **Tests:** 353 database checks and 14 unit tests.
    - **Not done in code:** an external penetration test. One is recommended before or soon after launch.

## 7. Security risk checklist

| Risk | Control | Status |
|---|---|---|
| Privilege escalation via client role | Roles only in `role_assignments`; insert limited to super admin and never self | ✔ S1 + test |
| Signup metadata used for roles | `handle_new_user` creates profile only | ✔ S1 |
| Public signup creating accounts | Disable signups in Lovable Cloud auth settings | ⚠ manual setting |
| Drafts leaking to public | RLS + explicit `status/publish_at` filters | ✔ S1 + test |
| Audit tampering | No write grants; SECURITY DEFINER trigger only | ✔ S1 + test |
| Audit log containing PII | Logs field names only, not values | ✔ S1 |
| XSS in notices | Plain-text rendering only, no `dangerouslySetInnerHTML` | ✔ S1 |
| PostgREST filter injection via search | `sanitizeSearch` strips filter metacharacters | ✔ S1 |
| Account enumeration on login/reset | Uniform error and success messages | ✔ S1 |
| Brute force | Supabase auth rate limits; per-IP form limits; CAPTCHA; status-lookup and export limits | ✔ S3/S10 + test |
| Confidential files public | Private `admission-documents` bucket; 5-minute signed URLs for admission staff only | ✔ S3 + test |
| Spam / abusive applications | Per-IP rate limit, duplicate-application guard, optional Turnstile CAPTCHA | ✔ S3 (CAPTCHA widget S10) |
| Malicious uploads | Server checks magic bytes (PDF/JPEG/PNG/WebP), 5 MB limit, random names | ✔ S3 |
| Status lookup brute force | Three factors + 10 attempts/hour per reference; no personal data returned | ✔ S3 + test |
| Applicant data edited outside workflow | No direct write grants; transitions enforced in SQL with history | ✔ S3 + test |
| Personal files uploaded to public bucket by mistake | Upload warning; uploads limited to approved folders; random file names | ✔ S2 + test |
| Deactivated user keeps access | `has_role` requires `is_active`; edge function also bans sign-in | ✔ S2 + test |
| Service key exposure | Used only inside the `admin-users` edge function | ✔ S2 |
| Parent self-linking to a child | Links created only by staff, start unverified; RLS grants access only through verified links | ✔ S4 + test |
| Duplicate students from repeated admission | Unique `application_id`, row lock, idempotent function | ✔ S4 + test |
| Lost academic history | Enrollments cannot be deleted; status changes only via functions; students cannot be deleted | ✔ S4 + test |
| Unpublished results visible | Marks/report cards visible to students & guardians only when the exam is published | ✔ S6 + test |
| Marks tampering | Writes only via `save_marks` (assigned subject teacher, open exam); later changes only via approved corrections; audited | ✔ S6 + test |
| Payment tampering / duplicates | No direct writes or deletes; idempotency key; unique (method, transaction ID); overpayment blocked; reversals keep history | ✔ S7 + test |
| Accounts staff over-exposure to student data | Finance uses a minimal student directory, not full records | ✔ S7 + test |
| Parent link request abuse | Requests never grant access; staff approve only if the phone matches a guardian on record; max 5 pending per user | ✔ S8 + test |
| Learning files leaking across classes | Private `learning-resources` bucket; read only via a published resource the user may see; teachers upload only for sections they teach | ✔ S8 + test |
| Mass data export | Server-side exports with permission checks + audit (parameters only, no personal data in the log) | ✔ S9 + test |
| CSV formula injection | Cells starting with = + - @ are neutralised | ✔ S9 + test |
| Email leaking marks or provider key | Results emails carry no marks; provider key only in the edge function; HTML-escaped templates | ✔ S9 + test |
| Unwanted or duplicate emails | All events off by default; de-duplication keys; parent opt-out; idempotent sends | ✔ S9 + test |
| Secrets in frontend | Only `VITE_` publishable values; `.env.example` placeholders | ✔ S1 |
| Staff account takeover | TOTP MFA for staff, enforced in the database (aal2) once required; idle sign-out | ✔ S10 + test |
| Over-broad grants | TRUNCATE and anonymous write rights revoked; anonymous-callable privileged functions allow-listed; schema-wide lint in the test run | ✔ S10 + test |
| Unverified backups | Integrity report and record counts; restore drill procedure | ✔ S10 (drill itself: school) |

## 8. Institutional information to confirm

- Official **Bengali name** (currently a transliteration: নলেজ ইন ইন্টারন্যাশনাল স্কুল অ্যান্ড কলেজ) and Bengali translations of About/Mission/Vision
- **Logo** (SVG or high-resolution PNG) and any official colours
- **EIIN**, year of establishment, education board / affiliation, government recognition
- **Classes offered** in each stream (Bangla Medium / English Version) and whether college (XI–XII) sections exist
- Subjects per class and stream; section names
- Academic year pattern (January–December?), terms, working days, weekly holidays
- Grading scheme(s) and pass rules per class/exam; handling of absent/exempt
- Admission rounds, eligibility, age rules, required documents, admission test policy
- Fee categories and amounts, due dates, late fee, discount/waiver policy, accepted payment methods (bKash/Nagad/bank)
- Office hours; Google Maps pin
- Head of institution's name, photo and message; faculty list with consent
- Production domain (e.g. `knowledgeinn.edu.bd`) and an official institutional email (currently a personal Gmail address)
- Data retention periods and privacy contact person
- Transactional email provider choice (e.g. Resend), sender domain
