-- pgTAP tests for Stage 3 (academic structure + admissions). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(34);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'officer@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'admission_officer'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher');

insert into academic_years (id, code, name_en, starts_on, ends_on, admission_open) values
  ('10000000-0000-0000-0000-000000000027', '2027', 'AY 2027', '2027-01-01', '2027-12-31', true),
  ('10000000-0000-0000-0000-000000000026', '2026', 'AY 2026', '2026-01-01', '2026-12-31', false);
insert into classes (id, code, name_en, level) values
  ('20000000-0000-0000-0000-000000000006', 'class-6', 'Class 6', 6),
  ('20000000-0000-0000-0000-000000000010', 'class-10', 'Class 10', 10);
insert into class_streams (class_id, medium, admission_open) values
  ('20000000-0000-0000-0000-000000000006', 'bangla_medium', true),
  ('20000000-0000-0000-0000-000000000006', 'english_version', false),
  ('20000000-0000-0000-0000-000000000010', 'bangla_medium', false);
insert into admission_document_types (id, code, name_en, is_required) values
  ('30000000-0000-0000-0000-000000000001', 'birth-certificate', 'Birth certificate', true),
  ('30000000-0000-0000-0000-000000000002', 'transfer-certificate', 'TC', false);
insert into storage.objects (bucket_id, name) values ('admission-documents', 'applications/x.pdf');

-- A valid application payload and documents, reused below.
create temporary table fx (app jsonb, docs jsonb);
grant select on fx to anon, authenticated, service_role;
insert into fx values (
  jsonb_build_object(
    'academic_year_id', '10000000-0000-0000-0000-000000000027',
    'class_id', '20000000-0000-0000-0000-000000000006',
    'medium', 'bangla_medium',
    'student_name_en', 'Rahim Uddin',
    'date_of_birth', (current_date - interval '11 years')::date,
    'gender', 'male',
    'guardian_name', 'Karim Uddin',
    'guardian_relationship', 'Father',
    'guardian_phone', '+880 1712-345678',
    'present_address', 'Jatrabari, Dhaka',
    'permanent_address', 'Jatrabari, Dhaka'),
  '[{"document_type_id":"30000000-0000-0000-0000-000000000001","storage_path":"applications/a1.pdf","file_name":"birth.pdf","mime_type":"application/pdf","size_bytes":1000}]'::jsonb
);

-- ---------- Public visitors ----------
set local role anon;
select is((select count(*)::int from classes), 2, 'anon can read the class list (public academic info)');
select is((select count(*)::int from admission_applications), 0, 'anon cannot read applications');
select is((select count(*)::int from storage.objects where bucket_id = 'admission-documents'), 0, 'anon cannot see admission documents');
select throws_ok(
  $$select submit_admission_application((select app from fx), (select docs from fx))$$,
  '42501', null, 'anon cannot call the submission function directly');
select throws_ok(
  $$insert into classes (code, name_en, level) values ('hack', 'Hack', 1)$$,
  '42501', null, 'anon cannot change academic structure');
reset role;

-- ---------- Submission (as the edge function's service role) ----------
set local role service_role;
select throws_ok(
  $$select submit_admission_application((select app from fx), (select docs from fx))$$,
  'P0001', 'ADMISSION_CLOSED', 'submission is rejected while admission is closed');
reset role;
update admission_settings set is_open = true;
set local role service_role;

select is(
  (select submit_admission_application((select app from fx), (select docs from fx)) ->> 'reference_no'),
  'KI-APP-2027-00001', 'first application gets a sequential reference number');
select throws_ok(
  $$select submit_admission_application((select app from fx), (select docs from fx))$$,
  'P0001', 'DUPLICATE_APPLICATION', 'the same child cannot apply twice for the same year');
select is(
  (select submit_admission_application(
     (select app || '{"student_name_en":"Sumaiya Akter","gender":"female"}' from fx),
     (select replace(docs::text, 'a1.pdf', 'a2.pdf')::jsonb from fx)) ->> 'reference_no'),
  'KI-APP-2027-00002', 'second application gets the next number');
select throws_ok(
  $$select submit_admission_application((select app || '{"student_name_en":"No Docs"}' from fx), '[]'::jsonb)$$,
  'P0001', 'MISSING_DOCUMENTS', 'required documents are enforced');
select throws_ok(
  $$select submit_admission_application((select app || '{"student_name_en":"Bad Phone","guardian_phone":"12345"}' from fx), (select docs from fx))$$,
  'P0001', 'INVALID_PHONE', 'invalid Bangladeshi phone numbers are rejected');
select throws_ok(
  $$select submit_admission_application((select app || '{"student_name_en":"EV Kid","medium":"english_version"}' from fx), (select docs from fx))$$,
  'P0001', 'INVALID_CLASS', 'a class/stream combination closed for admission is rejected');
select throws_ok(
  $$select submit_admission_application((select app || '{"student_name_en":"Old Year","academic_year_id":"10000000-0000-0000-0000-000000000026"}' from fx), (select docs from fx))$$,
  'P0001', 'INVALID_YEAR', 'an academic year closed for admission is rejected');
select throws_ok(
  $$select submit_admission_application((select app || jsonb_build_object('student_name_en','Baby','date_of_birth', current_date - 100) from fx), (select docs from fx))$$,
  'P0001', 'INVALID_DOB', 'implausible dates of birth are rejected');
select throws_ok(
  $$select submit_admission_application((select app || '{"student_name_en":"No Gender","gender":""}' from fx), (select docs from fx))$$,
  'P0001', 'GENDER_REQUIRED', 'configurable required fields are enforced');
reset role;

select is(
  (select guardian_phone from admission_applications where reference_no = 'KI-APP-2027-00001'),
  '01712345678', 'phone numbers are stored in normalised form');
select is(
  (select count(*)::int from admission_status_history h join admission_applications a on a.id = h.application_id
    where a.reference_no = 'KI-APP-2027-00001' and h.to_status = 'submitted'),
  1, 'submission is recorded in the status history');

-- ---------- Applicant status lookup ----------
set local role anon;
select is(
  (select lookup_admission_status('ki-app-2027-00001', '01712345678', (current_date - interval '11 years')::date) ->> 'status'),
  'submitted', 'applicant can look up status with reference + phone + date of birth');
select is(
  lookup_admission_status('KI-APP-2027-00001', '01700000000', (current_date - interval '11 years')::date),
  null::jsonb, 'lookup with a wrong phone reveals nothing');
select is(
  (select lookup_admission_status('KI-APP-2027-00001', '01712345678', (current_date - interval '11 years')::date) ? 'guardian_name'),
  false, 'lookup does not expose personal details');
reset role;
-- Use up the remaining attempts for this reference (10 per hour).
select lookup_admission_status('KI-APP-2027-00001', '0', current_date) from generate_series(1, 7);
set local role anon;
select throws_ok(
  $$select lookup_admission_status('KI-APP-2027-00001', '01712345678', current_date)$$,
  'P0001', 'TOO_MANY_ATTEMPTS', 'repeated lookups for one reference are rate-limited');
reset role;

-- ---------- Staff access & workflow ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from admission_applications), 0, 'teachers cannot see applications');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from admission_applications), 2, 'the principal can view applications');
select throws_ok(
  $$select change_application_status((select id from admission_applications where reference_no = 'KI-APP-2027-00001'), 'under_review')$$,
  '42501', null, 'the principal cannot change application status');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'admission-documents'), 1, 'admission officers can access documents');
select throws_ok(
  $$update admission_applications set status = 'approved'$$,
  '42501', null, 'applications cannot be edited directly, only through the workflow');
select throws_ok(
  $$select change_application_status((select id from admission_applications where reference_no = 'KI-APP-2027-00001'), 'approved')$$,
  'P0001', 'INVALID_TRANSITION', 'an application cannot jump from submitted to approved');
select throws_ok(
  $$select change_application_status((select id from admission_applications where reference_no = 'KI-APP-2027-00001'), 'info_required', '  ')$$,
  'P0001', 'NOTE_REQUIRED', 'requesting more information requires a message');
select lives_ok(
  $$select change_application_status((select id from admission_applications where reference_no = 'KI-APP-2027-00001'), 'under_review')$$,
  'officer can start the review');
select lives_ok(
  $$select change_application_status((select id from admission_applications where reference_no = 'KI-APP-2027-00001'), 'approved', 'Please visit the office.')$$,
  'officer can approve after review');
select throws_ok(
  $$select change_application_status((select id from admission_applications where reference_no = 'KI-APP-2027-00001'), 'admitted')$$,
  'P0001', 'INVALID_TRANSITION', 'admitted can only be set by student conversion');
select throws_ok(
  $$insert into classes (code, name_en, level) values ('class-7', 'Class 7', 7)$$,
  '42501', null, 'admission officers cannot change the academic structure');
reset role;

select is(
  (select array_agg(h.to_status::text order by h.changed_at, h.id) from admission_status_history h
    join admission_applications a on a.id = h.application_id where a.reference_no = 'KI-APP-2027-00001'),
  array['submitted', 'under_review', 'approved'], 'every status change is recorded in order');
select is(
  (select reviewed_by from admission_applications where reference_no = 'KI-APP-2027-00001'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'the deciding officer is recorded');

select * from finish();
rollback;
