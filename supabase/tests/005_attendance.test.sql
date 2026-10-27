-- pgTAP tests for Stage 5 (teachers & attendance). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(35);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'teacher2@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'teacher3@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'parent1@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'student2@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000b2', 'teacher'),
  ('00000000-0000-0000-0000-0000000000b3', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f1', 'guardian'),
  ('00000000-0000-0000-0000-0000000000c2', 'student');

-- Working days are made independent of the real weekday; specific tests change them.
update attendance_settings set weekly_off_days = '{}', teacher_edit_days = 3;

insert into academic_years (id, code, name_en, starts_on, ends_on)
  values ('10000000-0000-0000-0000-000000000026', '2026', 'AY', school_today() - 200, school_today() + 100);
insert into classes (id, code, name_en, level) values ('20000000-0000-0000-0000-000000000006', 'class-6', 'Class 6', 6);
insert into class_streams (class_id, medium) values ('20000000-0000-0000-0000-000000000006', 'bangla_medium');
insert into sections (id, academic_year_id, class_id, medium, name) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'A'),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'B');
insert into subjects (id, code, name_en) values
  ('70000000-0000-0000-0000-000000000001', 'math', 'Mathematics'),
  ('70000000-0000-0000-0000-000000000002', 'english', 'English');
insert into class_subjects (class_id, medium, subject_id)
  values ('20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000001');

create temporary table fx (name text primary key, id uuid);
grant select on fx to anon, authenticated;
insert into fx
select n, _create_student('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
         sec::uuid, roll, n, null, '2014-01-01', 'male', school_today() - 200, null, 'Dhaka 1236', 'Dhaka 1236', null,
         n || ' Parent', 'Father', phone, null, true)
from (values
  ('s1', '40000000-0000-0000-0000-00000000000a', 1, '01710000001'),
  ('s2', '40000000-0000-0000-0000-00000000000a', 2, '01710000002'),
  ('s3', '40000000-0000-0000-0000-00000000000b', 1, '01710000003')
) as v(n, sec, roll, phone);
update guardians set user_id = '00000000-0000-0000-0000-0000000000f1' where phone = '01710000001';
update students set user_id = '00000000-0000-0000-0000-0000000000c2' where id = (select id from fx where name = 's2');

-- ---------- Teachers & assignments (school admin) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into teachers (id, name_en, user_id, show_on_website, phone) values
  ('80000000-0000-0000-0000-000000000001', 'Teacher One', '00000000-0000-0000-0000-0000000000b1', true, '01810000001'),
  ('80000000-0000-0000-0000-000000000002', 'Teacher Two', '00000000-0000-0000-0000-0000000000b2', false, null),
  ('80000000-0000-0000-0000-000000000003', 'Teacher Three', '00000000-0000-0000-0000-0000000000b3', false, null);
insert into teacher_assignments (teacher_id, section_id, role, subject_id) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', 'class_teacher', null),
  ('80000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-00000000000a', 'subject_teacher', '70000000-0000-0000-0000-000000000001');
select is((select staff_code from teachers where name_en = 'Teacher One'), 'KI-T-001', 'teachers get a generated staff code');
select throws_ok(
  $$insert into teacher_assignments (teacher_id, section_id, role, subject_id)
    values ('80000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-00000000000a', 'subject_teacher', '70000000-0000-0000-0000-000000000002')$$,
  'P0001', 'SUBJECT_NOT_IN_CURRICULUM', 'subjects outside the class curriculum cannot be assigned');
select throws_ok(
  $$insert into teacher_assignments (teacher_id, section_id, role)
    values ('80000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-00000000000a', 'class_teacher')$$,
  '23505', null, 'a section has only one class teacher');
reset role;

-- ---------- Teacher 1 (class teacher of section A) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from get_section_roster('40000000-0000-0000-0000-00000000000a')), 2, 'class teacher gets the section roster');
select is((select count(*)::int from students), 0, 'teachers cannot read full student records');
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000b', school_today(),
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's3'), 'status', 'present')))$$,
  '42501', null, 'a teacher cannot record attendance for an unassigned section');
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today() + 1,
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present')))$$,
  'P0001', 'FUTURE_DATE', 'attendance cannot be recorded for future dates');
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today(),
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's3'), 'status', 'present')))$$,
  'P0001', 'STUDENT_NOT_IN_SECTION', 'students from another section are rejected');
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today(), jsonb_build_array(
     jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present'),
     jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'absent')))$$,
  'P0001', 'DUPLICATE_STUDENT', 'a student cannot appear twice in one sheet');
select lives_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today(), jsonb_build_array(
     jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present'),
     jsonb_build_object('student_id', (select id from fx where name = 's2'), 'status', 'absent')))$$,
  'the class teacher records today''s attendance');
select lives_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today(), jsonb_build_array(
     jsonb_build_object('student_id', (select id from fx where name = 's2'), 'status', 'late', 'note', 'Arrived 9:20')))$$,
  'the class teacher can update today''s sheet');
select is((select count(*)::int from attendance_sessions), 1, 'saving again does not create a duplicate session');
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today() - 10,
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present')))$$,
  'P0001', 'EDIT_WINDOW_CLOSED', 'teachers cannot edit attendance outside the edit window');
select throws_ok(
  $$insert into attendance_records (session_id, student_id, status)
    values ((select id from attendance_sessions limit 1), (select id from fx where name = 's1'), 'absent')$$,
  '42501', null, 'attendance cannot be written directly');
reset role;

-- ---------- Teacher 2 (subject teacher) and Teacher 3 (unassigned) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today(),
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'absent')))$$,
  '42501', null, 'only the class teacher records daily attendance');
select is((select count(*)::int from attendance_records), 2, 'subject teachers can view their section''s attendance');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select count(*)::int from attendance_records), 0, 'unassigned teachers see no attendance');
select throws_ok(
  $$select * from get_section_roster('40000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'unassigned teachers cannot get the roster');
reset role;

-- ---------- Administrator: past dates and working days ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today() - 10, jsonb_build_array(
     jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'absent'),
     jsonb_build_object('student_id', (select id from fx where name = 's2'), 'status', 'present')))$$,
  'administrators can record attendance for earlier dates');
insert into holidays (starts_on, name_en) values (school_today() - 1, 'Test holiday');
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today() - 1,
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present')))$$,
  'P0001', 'NOT_A_WORKING_DAY', 'attendance cannot be recorded on holidays');
update attendance_settings set weekly_off_days = array[extract(isodow from school_today() - 2)::int];
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today() - 2,
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present')))$$,
  'P0001', 'NOT_A_WORKING_DAY', 'attendance cannot be recorded on the weekly off-day');
update attendance_settings set weekly_off_days = '{}';
select throws_ok(
  $$select save_attendance('40000000-0000-0000-0000-00000000000a', school_today() - 300,
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'status', 'present')))$$,
  'P0001', 'OUTSIDE_ACADEMIC_YEAR', 'dates outside the academic year are rejected');
reset role;

-- ---------- Parents and students see only their own child ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(
  (select count(*)::int from attendance_records where student_id = (select id from fx where name = 's1')), 2,
  'a guardian sees their child''s attendance');
select is((select count(*)::int from attendance_records), 2, 'a guardian does not see classmates'' attendance');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select is(
  (select array_agg(status::text order by status::text) from attendance_records), array['late', 'present'],
  'a student sees only their own attendance');
reset role;

-- ---------- Correction workflow ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$select request_attendance_correction(
     (select id from attendance_sessions where date = school_today() - 10), (select id from fx where name = 's1'), 'present', 'Was at a school event')$$,
  'a section teacher can request a correction for an old date');
select throws_ok(
  $$select request_attendance_correction(
     (select id from attendance_sessions where date = school_today() - 10), (select id from fx where name = 's1'), 'leave', 'Another request')$$,
  'P0001', 'ALREADY_PENDING', 'only one pending request per record');
select throws_ok(
  $$select review_attendance_correction((select id from attendance_correction_requests limit 1), true)$$,
  '42501', null, 'teachers cannot approve corrections');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$select review_attendance_correction((select id from attendance_correction_requests limit 1), true, 'Confirmed')$$,
  'the principal approves the correction');
select is(
  (select status::text from attendance_records r join attendance_sessions a on a.id = r.session_id
    where a.date = school_today() - 10 and r.student_id = (select id from fx where name = 's1')),
  'present', 'an approved correction updates the record');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select request_attendance_correction(
  (select id from attendance_sessions where date = school_today()), (select id from fx where name = 's2'), 'present', 'Bus was late');
select throws_ok(
  $$select review_attendance_correction((select id from attendance_correction_requests where status = 'pending'), true)$$,
  'P0001', 'SELF_REVIEW', 'nobody approves their own correction request');
reset role;

select ok(
  (select count(*) > 0 from audit_logs where table_name = 'attendance_records' and action = 'update'
     and actor_id = '00000000-0000-0000-0000-0000000000e1'),
  'attendance changes are written to the audit log with the actor');

-- ---------- Reports & public faculty ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select present from attendance_section_summary('40000000-0000-0000-0000-00000000000a', school_today() - 30, school_today())
    where student_id = (select id from fx where name = 's1')),
  2, 'section summary counts days present');
select throws_ok($$select * from attendance_overview(school_today())$$, '42501', null, 'teachers cannot see the whole-school overview');
reset role;

set local role anon;
select is((select count(*)::int from get_public_faculty()), 1, 'the website lists only teachers marked for publication');
reset role;

select * from finish();
rollback;
