-- pgTAP tests for Stage 10 (hardening). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'parent@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f1', 'guardian');
update user_profiles set full_name = 'Super Admin' where id = '00000000-0000-0000-0000-0000000000a1';
insert into auth.mfa_factors (user_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'verified'),
  ('00000000-0000-0000-0000-0000000000a2', 'unverified');

insert into academic_years (id, code, name_en, starts_on, ends_on)
  values ('10000000-0000-0000-0000-000000000026', '2026', 'AY 2026', school_today() - 200, school_today() + 100);
insert into classes (id, code, name_en, level) values ('20000000-0000-0000-0000-000000000006', 'class-6', 'Class 6', 6);
insert into class_streams (class_id, medium) values ('20000000-0000-0000-0000-000000000006', 'bangla_medium');
create temporary table fx (name text primary key, id uuid);
grant select on fx to anon, authenticated;
insert into fx
select 's1', _create_student('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
         null, null, 's1', null, '2014-01-01', 'male', school_today() - 200, null, 'Dhaka 1236', 'Dhaka 1236', null,
         's1 Parent', 'Father', '01710000001', null, true);
update guardians set user_id = '00000000-0000-0000-0000-0000000000f1';

-- ---------- MFA policy off (default) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
select is((select count(*)::int from students), 1, 'while MFA is optional, staff work with a password-only session');
select throws_ok($$select set_staff_mfa_required(true)$$, '42501', null, 'only a super administrator sets the MFA policy');
select throws_ok($$update security_settings set require_staff_mfa = true$$, '42501', null, 'the policy cannot be changed directly');
select is((select require_staff_mfa from security_settings), false, 'signed-in users can read the policy');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select throws_ok($$select set_staff_mfa_required(true)$$, 'P0001', 'MFA_REQUIRED_FIRST',
  'a super administrator must verify with MFA before requiring it (no self lock-out)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}';
select lives_ok($$select set_staff_mfa_required(true)$$, 'a super administrator with MFA requires it for staff');
select is(
  (select string_agg(full_name || ':' || has_mfa, ',' order by full_name) from staff_mfa_status() where full_name <> ''),
  'Super Admin:true', 'super administrators see which staff have set up MFA');
select is(
  (select has_mfa from staff_mfa_status() where user_id = '00000000-0000-0000-0000-0000000000a2'), false,
  'an unfinished (unverified) factor does not count');
reset role;
select is(
  (select updated_by from security_settings), '00000000-0000-0000-0000-0000000000a1'::uuid, 'the policy change records who made it');
select is(
  (select count(*)::int from audit_logs where table_name = 'security_settings'), 1, 'the policy change is in the audit log');

-- ---------- MFA policy on ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
select is(has_role('school_admin'), false, 'a staff role does not count in a password-only session');
select is((select count(*)::int from students), 0, 'staff see no student records without MFA');
select throws_ok($$select export_report('students', '{"year":"10000000-0000-0000-0000-000000000026"}')$$,
  '42501', null, 'staff cannot export without MFA');
select is((select count(*)::int from role_assignments where user_id = auth.uid()), 1,
  'staff can still read their own roles (so the console can ask for a code)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}';
select is((select count(*)::int from students), 1, 'after the second factor, staff access is restored');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated","aal":"aal1"}';
select is((select count(*)::int from students), 1, 'parents are not affected by the staff MFA policy');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
select is(has_role('teacher'), true, 'teachers are not affected by the staff MFA policy');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
select throws_ok($$select set_staff_mfa_required(false)$$, '42501', null,
  'a password-only session cannot switch the requirement off');
reset role;

-- ---------- Export rate limit ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}';
select is(
  (select count(*)::int from generate_series(1, 120) g,
     lateral export_report('students', jsonb_build_object('year', '10000000-0000-0000-0000-000000000026', 'run', g)) r),
  120, 'staff can run 120 reports in an hour');
select throws_ok($$select export_report('students', '{"year":"10000000-0000-0000-0000-000000000026"}')$$,
  'P0001', 'RATE_LIMITED', 'the next report in the same hour is refused');
select throws_ok($$select _export_report('students', '{}')$$, '42501', null, 'the unlimited export function is not callable');
reset role;

-- ---------- Integrity report (database owner, as in the SQL editor) ----------
set local request.jwt.claims = '{}';
select is((select sum(problems)::int from integrity_report()), 0, 'a healthy database has no integrity problems');
insert into students (student_code, admission_no, name_en, date_of_birth, medium)
  values ('KI20269999', 'KI-ADM-2026-99999', 'Orphan Record', '2014-01-01', 'bangla_medium');
insert into student_documents (student_id, title, bucket, storage_path, file_name, mime_type, size_bytes)
  values ((select id from fx), 'Lost file', 'student-documents', 'x/missing.pdf', 'missing.pdf', 'application/pdf', 100);
select is(
  (select string_agg(check_name, ',' order by check_name) from integrity_report() where problems > 0),
  'student_document_files_missing,students_without_enrollment', 'the integrity report finds broken records and missing files');
select ok((select value from data_fingerprint() where item = 'students') = 2, 'the fingerprint counts records');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}';
select throws_ok($$select * from integrity_report()$$, '42501', null, 'only super administrators run the integrity report');
reset role;
set local role anon;
set local request.jwt.claims = '{}';
select throws_ok($$select * from data_fingerprint()$$, '42501', null, 'anonymous visitors cannot run it at all');
reset role;

select * from finish();
rollback;
