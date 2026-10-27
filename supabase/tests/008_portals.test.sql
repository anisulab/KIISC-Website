-- pgTAP tests for Stage 8 (portals, timetables, resources, link requests). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(25);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'teacher2@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'student1@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'parent1@test.local'),
  ('00000000-0000-0000-0000-0000000000f9', 'newparent@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000b2', 'teacher'),
  ('00000000-0000-0000-0000-0000000000c1', 'student'),
  ('00000000-0000-0000-0000-0000000000f1', 'guardian'),
  ('00000000-0000-0000-0000-0000000000f9', 'guardian');

insert into academic_years (id, code, name_en, starts_on, ends_on)
  values ('10000000-0000-0000-0000-000000000026', '2026', 'AY 2026', '2026-01-01', '2026-12-31');
insert into classes (id, code, name_en, level) values ('20000000-0000-0000-0000-000000000006', 'class-6', 'Class 6', 6);
insert into class_streams (class_id, medium) values ('20000000-0000-0000-0000-000000000006', 'bangla_medium');
insert into sections (id, academic_year_id, class_id, medium, name) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'A'),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'B');
insert into subjects (id, code, name_en) values
  ('70000000-0000-0000-0000-000000000001', 'math', 'Mathematics'),
  ('70000000-0000-0000-0000-000000000002', 'music', 'Music');
insert into class_subjects (class_id, medium, subject_id)
  values ('20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000001');
insert into timetable_periods (academic_year_id, period_no, starts_at, ends_at, is_break) values
  ('10000000-0000-0000-0000-000000000026', 1, '08:00', '08:45', false),
  ('10000000-0000-0000-0000-000000000026', 2, '08:45', '09:00', true);

create temporary table fx (name text primary key, id uuid);
grant select on fx to anon, authenticated;
insert into fx
select n, _create_student('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
         sec::uuid, 1, n, null, '2014-01-01', 'male', '2026-01-02', null, 'Dhaka 1236', 'Dhaka 1236', null,
         n || ' Parent', 'Father', phone, null, true)
from (values ('s1', '40000000-0000-0000-0000-00000000000a', '01710000001'), ('s2', '40000000-0000-0000-0000-00000000000b', '01710000002')) as v(n, sec, phone);
update students set user_id = '00000000-0000-0000-0000-0000000000c1' where id = (select id from fx where name = 's1');
update guardians set user_id = '00000000-0000-0000-0000-0000000000f1' where phone = '01710000001';
insert into teachers (id, name_en, user_id) values
  ('80000000-0000-0000-0000-000000000001', 'Teacher One', '00000000-0000-0000-0000-0000000000b1'),
  ('80000000-0000-0000-0000-000000000002', 'Teacher Two', '00000000-0000-0000-0000-0000000000b2');
insert into teacher_assignments (teacher_id, section_id, role) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', 'class_teacher');

-- ---------- Timetable (school admin) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$insert into timetable_entries (section_id, weekday, period_no, subject_id, teacher_id)
    values ('40000000-0000-0000-0000-00000000000a', 1, 1, '70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001')$$,
  'an admin can add a timetable entry');
select throws_ok(
  $$insert into timetable_entries (section_id, weekday, period_no, subject_id, teacher_id)
    values ('40000000-0000-0000-0000-00000000000b', 1, 1, '70000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'a teacher cannot be timetabled in two sections at the same time');
select throws_ok(
  $$insert into timetable_entries (section_id, weekday, period_no, subject_id)
    values ('40000000-0000-0000-0000-00000000000b', 2, 1, '70000000-0000-0000-0000-000000000002')$$,
  'P0001', 'SUBJECT_NOT_IN_CURRICULUM', 'only curriculum subjects can be timetabled');
select throws_ok(
  $$insert into timetable_entries (section_id, weekday, period_no, subject_id)
    values ('40000000-0000-0000-0000-00000000000b', 2, 2, '70000000-0000-0000-0000-000000000001')$$,
  'P0001', 'INVALID_PERIOD', 'lessons cannot be placed in a break period');
insert into timetable_entries (section_id, weekday, period_no, subject_id)
  values ('40000000-0000-0000-0000-00000000000b', 3, 1, '70000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into learning_resources (academic_year_id, class_id, medium, title_en, external_url)
    values ('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'Class 6 reading list', 'https://example.org/list')$$,
  'an admin can share a resource with a whole class');
select lives_ok(
  $$insert into learning_resources (academic_year_id, class_id, medium, title_en, external_url, is_published)
    values ('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'Draft notes', 'https://example.org/draft', false)$$,
  'an admin can keep a resource unpublished');
select throws_ok(
  $$insert into learning_resources (academic_year_id, class_id, medium, title_en, external_url)
    values ('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'Bad link', 'http://insecure.example')$$,
  '23514', null, 'resource links must use https');
reset role;

-- ---------- Teachers & resources ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$insert into learning_resources (academic_year_id, class_id, medium, section_id, title_en, external_url)
    values ('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
            '40000000-0000-0000-0000-00000000000a', 'Section A homework', 'https://example.org/hw')$$,
  'a teacher can share a resource with their own section');
select throws_ok(
  $$insert into learning_resources (academic_year_id, class_id, medium, section_id, title_en, external_url)
    values ('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
            '40000000-0000-0000-0000-00000000000b', 'Not my section', 'https://example.org/x')$$,
  '42501', null, 'a teacher cannot share resources with sections they do not teach');
select throws_ok(
  $$insert into learning_resources (academic_year_id, class_id, medium, title_en, external_url)
    values ('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'Whole class', 'https://example.org/y')$$,
  '42501', null, 'teachers cannot post class-wide resources without a section');
select ok(public._teaches_folder('40000000-0000-0000-0000-00000000000a/file.pdf'), 'teachers may upload files into their section folder');
select ok(not public._teaches_folder('not-a-uuid/file.pdf'), 'malformed upload folders are rejected');
reset role;

-- ---------- Student portal ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from timetable_entries), 1, 'a student sees only their own section''s timetable');
select is(
  (select array_agg(title_en order by title_en) from learning_resources),
  array['Class 6 reading list', 'Section A homework'], 'a student sees published resources for their class and section only');
select throws_ok(
  $$insert into guardian_link_requests (student_code, guardian_phone, relationship) values ('KI20260002', '01710000002', 'Father')$$,
  '42501', null, 'students cannot submit guardian link requests');
reset role;

-- ---------- Parent portal ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from timetable_entries), 1, 'a parent sees their child''s timetable');
select is((select count(*)::int from learning_resources), 2, 'a parent sees their child''s resources');
reset role;

-- ---------- Guardian link request workflow ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}';
select is((select count(*)::int from students), 0, 'a new parent sees no students before verification');
select lives_ok(
  $$insert into guardian_link_requests (student_code, guardian_phone, relationship) values ('ki20260002', '01799999999', 'Father')$$,
  'a parent can request a link to a child');
select throws_ok(
  $$select review_guardian_link_request((select id from guardian_link_requests limit 1), true)$$,
  '42501', null, 'a parent cannot approve their own request');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select review_guardian_link_request((select id from guardian_link_requests limit 1), true)$$,
  'P0001', 'PHONE_MISMATCH', 'approval fails when the phone does not match a guardian on record');
reset role;
-- The parent submits again with the phone that is on the student's record.
update guardian_link_requests set status = 'rejected';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}';
insert into guardian_link_requests (student_code, guardian_phone, relationship) values ('KI20260002', '+8801710000002', 'Father');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$select review_guardian_link_request((select id from guardian_link_requests where status = 'pending'), true, 'ID checked at office')$$,
  'staff approve a request whose phone matches the record');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}';
select is((select student_code from students), 'KI20260002', 'after approval the parent sees exactly their child');
select is((select count(*)::int from timetable_entries), 1, 'and only that child''s timetable');
reset role;
select is(
  (select count(*)::int from student_guardians sg join guardians g on g.id = sg.guardian_id
    where g.user_id = '00000000-0000-0000-0000-0000000000f9' and sg.verified_at is not null),
  1, 'the approved link is verified');

select * from finish();
rollback;
