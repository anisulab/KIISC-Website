-- pgTAP tests for Stage 9 (report exports, email notifications). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(50);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'teacher2@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'parent1@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts_officer'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000b2', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f1', 'guardian');

update attendance_settings set weekly_off_days = '{}';
insert into academic_years (id, code, name_en, starts_on, ends_on)
  values ('10000000-0000-0000-0000-000000000026', '2026', 'AY 2026', school_today() - 200, school_today() + 100);
insert into classes (id, code, name_en, level) values ('20000000-0000-0000-0000-000000000006', 'class-6', 'Class 6', 6);
insert into class_streams (class_id, medium) values ('20000000-0000-0000-0000-000000000006', 'bangla_medium');
insert into sections (id, academic_year_id, class_id, medium, name) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'A');
insert into subjects (id, code, name_en) values
  ('70000000-0000-0000-0000-000000000001', 'math', 'Mathematics'),
  ('70000000-0000-0000-0000-000000000002', 'english', 'English');
insert into class_subjects (class_id, medium, subject_id) values
  ('20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000002');

-- s1: verified guardian with email; s2: unverified guardian with email; s3: verified, no email.
create temporary table fx (name text primary key, id uuid);
grant select on fx to anon, authenticated, service_role;
insert into fx
select n, _create_student('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
         '40000000-0000-0000-0000-00000000000a', roll, n, null, '2014-01-01', 'male', school_today() - 200, null, 'Dhaka 1236', 'Dhaka 1236', null,
         n || ' Parent', 'Father', phone, email, verified)
from (values
  ('s1', 1, '01710000001', 'P1@Example.com', true),
  ('s2', 2, '01710000002', 'p2@example.com', false),
  ('s3', 3, '01710000003', null, true)
) as v(n, roll, phone, email, verified);
update guardians set user_id = '00000000-0000-0000-0000-0000000000f1' where phone = '01710000001';

insert into teachers (id, name_en, user_id) values
  ('80000000-0000-0000-0000-000000000001', 'Teacher One', '00000000-0000-0000-0000-0000000000b1'),
  ('80000000-0000-0000-0000-000000000002', 'Teacher Two', '00000000-0000-0000-0000-0000000000b2');
insert into teacher_assignments (teacher_id, section_id, role) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', 'class_teacher');

insert into grading_schemes (id, name_en) values ('90000000-0000-0000-0000-000000000001', 'Test scheme');
insert into grade_rules (scheme_id, grade, min_percent, max_percent, grade_point, is_fail) values
  ('90000000-0000-0000-0000-000000000001', 'A+', 80, 100, 5.00, false),
  ('90000000-0000-0000-0000-000000000001', 'F', 0, 79.99, 0.00, true);
insert into examinations (id, academic_year_id, name_en, grading_scheme_id)
  values ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000026', 'Half-yearly', '90000000-0000-0000-0000-000000000001');
insert into examination_subjects (id, examination_id, class_id, medium, subject_id, full_marks, pass_marks) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000001', 100, 33),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000002', 100, 33);

-- ---------- Exports: permissions and audit ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  jsonb_array_length(export_report('students', '{"year":"10000000-0000-0000-0000-000000000026"}') -> 'rows'), 3,
  'administrators can export the student list');
select is(
  export_report('students', '{"year":"10000000-0000-0000-0000-000000000026"}') -> 'rows' -> 0 ->> 'guardian_phone', '01710000001',
  'the student export is ordered by roll and includes the guardian contact');
select ok(
  not (export_report('students', '{"year":"10000000-0000-0000-0000-000000000026"}') -> 'rows' -> 0 ? '_level'),
  'internal sort columns are not exported');
select lives_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', jsonb_build_array(
      jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 85),
      jsonb_build_object('student_id', (select id from fx where name = 's2'), 'mark_status', 'absent')))$$,
  'fixture: marks are entered');
select is(
  export_report('exam_results', '{"exam":"a0000000-0000-0000-0000-000000000001","section":"40000000-0000-0000-0000-00000000000a"}') -> 'subjects' -> 0 ->> 'name_en',
  'English', 'the results export lists the exam subjects');
select is(
  (select r -> 'marks' ->> '70000000-0000-0000-0000-000000000001'
   from jsonb_array_elements(export_report('exam_results',
     '{"exam":"a0000000-0000-0000-0000-000000000001","section":"40000000-0000-0000-0000-00000000000a"}') -> 'rows') r
   where r ->> 'name_en' = 's2'),
  'AB', 'absent students are marked AB in the results export');
select is(
  jsonb_array_length(export_report('fee_collections', format('{"from":"%s","to":"%s"}', school_today() - 7, school_today())::jsonb) -> 'rows'),
  0, 'finance viewers can export the collection list');
select throws_ok(
  $$select export_report('attendance_absences', '{"from":"2026-05-01","to":"2026-04-01"}')$$,
  'P0001', 'INVALID_RANGE', 'a reversed date range is rejected');
select throws_ok(
  $$select export_report('attendance_absences', '{"from":"2024-01-01","to":"2026-01-01"}')$$,
  'P0001', 'INVALID_RANGE', 'exports are limited to one year at a time');
select throws_ok(
  $$select export_report('everything', '{}')$$, 'P0001', 'UNKNOWN_REPORT', 'unknown reports are rejected');
reset role;
select is(
  (select count(*)::int from audit_logs where action = 'export' and table_name = 'reports'
     and actor_id = '00000000-0000-0000-0000-0000000000a2'),
  6, 'every successful export is written to the audit log');
select ok(
  (select bool_and(not (metadata::text ilike '%01710000001%')) from audit_logs where action = 'export'),
  'the audit entry records parameters, not exported personal data');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}';
select throws_ok(
  $$select export_report('students', '{"year":"10000000-0000-0000-0000-000000000026"}')$$,
  '42501', null, 'accounts staff cannot export full student records');
select throws_ok(
  $$select export_report('admissions', '{"year":"10000000-0000-0000-0000-000000000026"}')$$,
  '42501', null, 'accounts staff cannot export admission applications');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  jsonb_array_length(export_report('attendance_summary',
    format('{"section":"40000000-0000-0000-0000-00000000000a","from":"%s","to":"%s"}', school_today() - 7, school_today())::jsonb) -> 'rows'),
  3, 'a class teacher can export attendance for their own section');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok(
  format($$select export_report('attendance_summary', '{"section":"40000000-0000-0000-0000-00000000000a","from":"%s","to":"%s"}')$$,
    school_today() - 7, school_today()),
  '42501', null, 'other teachers cannot export that section');
select throws_ok(
  $$select export_report('exam_results', '{"exam":"a0000000-0000-0000-0000-000000000001","section":"40000000-0000-0000-0000-00000000000a"}')$$,
  '42501', null, 'other teachers cannot export its results');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok(
  format($$select export_report('fee_collections', '{"from":"%s","to":"%s"}')$$, school_today() - 7, school_today()),
  '42501', null, 'guardians cannot export school reports');
reset role;

-- ---------- Notifications are off by default ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  format($$select save_attendance('40000000-0000-0000-0000-00000000000a', %L, jsonb_build_array(
      jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'absent')))$$, school_today()),
  'fixture: an absence is recorded');
select is((select count(*)::int from notification_outbox), 0, 'nothing is queued while notifications are switched off');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}';
select is((select count(*)::int from notification_events), 0, 'accounts staff cannot see notification settings');
select throws_ok(
  $$select queue_fee_reminders('10000000-0000-0000-0000-000000000026')$$,
  'P0001', 'NOTIFICATIONS_DISABLED', 'fee reminders explain that emails are switched off');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
update notification_events set enabled = true;
select is(
  (select count(*)::int from notification_events where enabled and updated_by = '00000000-0000-0000-0000-0000000000a2'), 5,
  'administrators switch notifications on, and who did it is recorded');
select throws_ok(
  $$insert into notification_outbox (event, dedupe_key, recipient_email) values ('fee_reminder', 'x', 'a@b.co')$$,
  '42501', null, 'messages cannot be queued directly');

-- ---------- Absence ----------
select lives_ok(
  format($$select save_attendance('40000000-0000-0000-0000-00000000000a', %L, jsonb_build_array(
      jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present'),
      jsonb_build_object('student_id', (select id from fx where name = 's2'), 'status', 'absent'),
      jsonb_build_object('student_id', (select id from fx where name = 's3'), 'status', 'absent')))$$, school_today()),
  'fixture: attendance is changed');
select is((select count(*)::int from notification_outbox), 0,
  'no email without a verified guardian email address');
select lives_ok(
  format($$select save_attendance('40000000-0000-0000-0000-00000000000a', %L, jsonb_build_array(
      jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'absent')))$$, school_today()),
  'fixture: s1 marked absent');
select is(
  (select recipient_email || ' ' || event || ' ' || (send_after > now()) from notification_outbox),
  'p1@example.com attendance_absent true', 'an absence email to the verified guardian waits before sending');
select lives_ok(
  format($$select save_attendance('40000000-0000-0000-0000-00000000000a', %L, jsonb_build_array(
      jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present')))$$, school_today()),
  'fixture: the teacher fixes the mistake');
reset role;

-- ---------- Payment, opt-out, fee reminders ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}';
insert into fee_categories (id, code, name_en) values ('c0000000-0000-0000-0000-000000000001', 'tuition', 'Monthly tuition');
insert into fee_structures (id, academic_year_id, class_id, medium, fee_category_id, amount, frequency) values
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', null,
   'c0000000-0000-0000-0000-000000000001', 1500, 'monthly');
select generate_invoices('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', null,
  array['d0000000-0000-0000-0000-000000000001']::uuid[], '2026-01', school_today() - 30, school_today() - 20, 'Tuition January') is not null as fixture;
select record_payment((select id from fx where name = 's1'), 500, 'cash', null, school_today()) is not null as fixture;
select is(
  (select count(*)::int from notification_outbox), 0, 'accounts staff cannot read the email log');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(set_my_email_notifications(false), 1, 'a guardian can stop school emails');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}';
select record_payment((select id from fx where name = 's1'), 100, 'cash', null, school_today()) is not null as fixture;
select is(queue_fee_reminders('10000000-0000-0000-0000-000000000026'), 0, 'no reminders go to guardians who opted out');
reset role;
select is(
  (select count(*)::int from notification_outbox where event = 'payment_received'), 1,
  'a payment receipt email is queued only while the guardian accepts emails');
select is(
  (select data ->> 'receipt_no' from notification_outbox where event = 'payment_received'),
  (select receipt_no from payments order by receipt_no limit 1), 'the receipt email carries the receipt number');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select set_my_email_notifications(true) = 1 as fixture;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}';
select is(queue_fee_reminders('10000000-0000-0000-0000-000000000026'), 1, 'fee reminders go to guardians with a balance due');
select is(queue_fee_reminders('10000000-0000-0000-0000-000000000026'), 0, 'a guardian gets at most one reminder per day');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select queue_fee_reminders('10000000-0000-0000-0000-000000000026')$$,
  '42501', null, 'only accounts staff send fee reminders');
reset role;

-- ---------- Results published ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_exam_status('a0000000-0000-0000-0000-000000000001', 'marks_entry') is null as fixture;
select set_exam_status('a0000000-0000-0000-0000-000000000001', 'under_review') is null as fixture;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select set_exam_status('a0000000-0000-0000-0000-000000000001', 'approved') is null as fixture;
select set_exam_status('a0000000-0000-0000-0000-000000000001', 'published') is null as fixture;
select set_exam_status('a0000000-0000-0000-0000-000000000001', 'approved') is null as fixture;
select set_exam_status('a0000000-0000-0000-0000-000000000001', 'published') is null as fixture;
reset role;
select is(
  (select count(*)::int from notification_outbox where event = 'results_published'), 1,
  'publishing results emails each verified guardian once, even if republished');
select ok(
  (select not (data ? 'marks') and not (data ? 'gpa') and data ->> 'exam_name_en' = 'Half-yearly'
   from notification_outbox where event = 'results_published'),
  'the results email names the exam but never contains marks');

-- ---------- Admissions ----------
insert into admission_applications (id, reference_no, academic_year_id, class_id, medium, student_name_en, date_of_birth,
  guardian_name, guardian_relationship, guardian_phone, guardian_email, present_address, permanent_address)
values ('e0000000-0000-0000-0000-000000000001', 'KI-APP-2026-00001', '10000000-0000-0000-0000-000000000026',
  '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'Applicant', '2015-01-01', 'Applicant Parent', 'Mother',
  '01710000009', 'applicant@example.com', 'Dhaka 1236', 'Dhaka 1236');
update admission_applications set status = 'under_review' where id = 'e0000000-0000-0000-0000-000000000001';
update admission_applications set status = 'approved' where id = 'e0000000-0000-0000-0000-000000000001';
select is(
  (select string_agg(data ->> 'status', ',' order by data ->> 'status') from notification_outbox where event = 'admission_status'),
  'approved,submitted', 'applicants are emailed on submission and on decisions, not on internal review');

-- ---------- Who can see and send ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from notification_outbox), 6, 'administrators can read the email log');
select throws_ok($$select * from claim_notifications(10)$$, '42501', null, 'signed-in users cannot run the sender');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from notification_outbox), 0, 'guardians cannot read the email log');
reset role;

-- ---------- Sending (edge function, service role) ----------
update notification_outbox set send_after = now() - interval '1 minute' where event = 'attendance_absent';
update notification_events set enabled = false where event = 'fee_reminder';
set local role service_role;
create temporary table claimed on commit drop as select * from claim_notifications(50);
select is((select count(*)::int from claimed), 4, 'the sender claims the due messages');
select is(
  (select last_error from notification_outbox where event = 'attendance_absent'), 'no_longer_absent',
  'an absence that was corrected is not emailed');
select is(
  (select last_error from notification_outbox where event = 'fee_reminder'), 'event_disabled',
  'messages for a switched-off event are not sent');
select complete_notification((select id from claimed where event = 'payment_received'), true) is null as fixture;
select complete_notification((select id from claimed where event = 'results_published'), false, 'mailbox full') is null as fixture;
select is(
  (select string_agg(status::text || ':' || attempts, ',' order by event) from notification_outbox
   where event in ('payment_received', 'results_published')),
  'sent:1,queued:1', 'a sent message is logged; a failed one is retried');
select ok(
  (select send_after > now() from notification_outbox where event = 'results_published'),
  'a failed message waits before the next attempt');
reset role;

update notification_outbox set attempts = 5, status = 'sending' where event = 'results_published';
set local role service_role;
select complete_notification((select id from notification_outbox where event = 'results_published'), false, 'bounced') is null as fixture;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select status::text from notification_outbox where event = 'results_published'), 'failed',
  'after five attempts a message is marked failed');
select lives_ok(
  $$select retry_notification((select id from notification_outbox where event = 'results_published'))$$,
  'administrators can retry a failed message');
reset role;

select * from finish();
rollback;
