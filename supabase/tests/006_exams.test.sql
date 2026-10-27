-- pgTAP tests for Stage 6 (examinations & results). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(39);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'mathteacher@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'parent2@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'student1@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f2', 'guardian'),
  ('00000000-0000-0000-0000-0000000000c1', 'student');

insert into academic_years (id, code, name_en, starts_on, ends_on)
  values ('10000000-0000-0000-0000-000000000026', '2026', 'AY 2026', '2026-01-01', '2026-12-31');
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

create temporary table fx (name text primary key, id uuid);
grant select on fx to anon, authenticated;
insert into fx
select n, _create_student('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
         '40000000-0000-0000-0000-00000000000a', roll, n, null, '2014-01-01', 'male', '2026-01-02', null, 'Dhaka 1236', 'Dhaka 1236', null,
         n || ' Parent', 'Father', phone, null, true)
from (values ('s1', 1, '01710000001'), ('s2', 2, '01710000002'), ('s3', 3, '01710000003'), ('s4', 4, '01710000004')) as v(n, roll, phone);
update students set user_id = '00000000-0000-0000-0000-0000000000c1' where id = (select id from fx where name = 's1');
update guardians set user_id = '00000000-0000-0000-0000-0000000000f2' where phone = '01710000002';

insert into teachers (id, name_en, user_id) values ('80000000-0000-0000-0000-000000000001', 'Math Teacher', '00000000-0000-0000-0000-0000000000b1');
insert into teacher_assignments (teacher_id, section_id, role, subject_id) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', 'subject_teacher', '70000000-0000-0000-0000-000000000001');

-- ---------- Grading scheme & exam (school admin) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into grading_schemes (id, name_en) values ('90000000-0000-0000-0000-000000000001', 'Test scheme');
insert into grade_rules (scheme_id, grade, min_percent, max_percent, grade_point, is_fail) values
  ('90000000-0000-0000-0000-000000000001', 'A+', 80, 100, 5.00, false),
  ('90000000-0000-0000-0000-000000000001', 'A', 60, 79.99, 4.00, false),
  ('90000000-0000-0000-0000-000000000001', 'C', 33, 59.99, 2.00, false),
  ('90000000-0000-0000-0000-000000000001', 'F', 0, 32.99, 0.00, true);
select throws_ok(
  $$insert into grade_rules (scheme_id, grade, min_percent, max_percent) values ('90000000-0000-0000-0000-000000000001', 'B', 70, 85)$$,
  'P0001', 'OVERLAPPING_RANGES', 'overlapping grade ranges are rejected');
insert into examinations (id, academic_year_id, name_en, grading_scheme_id)
  values ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000026', 'Half-yearly', '90000000-0000-0000-0000-000000000001');
insert into examination_subjects (id, examination_id, class_id, medium, subject_id, full_marks, pass_marks) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000001', 100, 33),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'bangla_medium', '70000000-0000-0000-0000-000000000002', 100, 33);
select throws_ok(
  $$update examinations set status = 'published' where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'P0001', 'USE_STATUS_FUNCTION', 'exam status cannot be edited directly');
reset role;

-- Teacher cannot enter marks while the exam is a draft.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 85)))$$,
  'P0001', 'EXAM_NOT_OPEN', 'teachers cannot enter marks before marks entry opens');
select throws_ok(
  $$select set_exam_status('a0000000-0000-0000-0000-000000000001', 'marks_entry')$$,
  '42501', null, 'teachers cannot change the exam status');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select set_exam_status('a0000000-0000-0000-0000-000000000001', 'marks_entry')$$, 'admin opens marks entry');
reset role;

-- ---------- Marks entry (math subject teacher) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', jsonb_build_array(
    jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 85),
    jsonb_build_object('student_id', (select id from fx where name = 's2'), 'marks', 30),
    jsonb_build_object('student_id', (select id from fx where name = 's3'), 'mark_status', 'absent'),
    jsonb_build_object('student_id', (select id from fx where name = 's4'), 'marks', 50.5))),
  4, 'the subject teacher enters marks for their subject');
select throws_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-00000000000a',
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 70)))$$,
  '42501', null, 'a teacher cannot enter marks for a subject they do not teach');
select throws_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 101)))$$,
  'P0001', 'INVALID_MARKS', 'marks above full marks are rejected');
select throws_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', -1)))$$,
  'P0001', 'INVALID_MARKS', 'negative marks are rejected');
select throws_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 85.555)))$$,
  'P0001', 'INVALID_MARKS', 'more than two decimal places are rejected');
select throws_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 40, 'mark_status', 'absent')))$$,
  'P0001', 'INVALID_MARKS', 'an absent student cannot also have marks');
select throws_ok(
  $$insert into student_marks (examination_subject_id, student_id, section_id, marks)
    values ('b0000000-0000-0000-0000-000000000002', (select id from fx where name = 's1'), '40000000-0000-0000-0000-00000000000a', 99)$$,
  '42501', null, 'marks cannot be written directly');
reset role;

-- English marks by the admin (s4 has no English mark: incomplete).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select save_marks('b0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-00000000000a', jsonb_build_array(
  jsonb_build_object('student_id', (select id from fx where name = 's1'), 'marks', 75),
  jsonb_build_object('student_id', (select id from fx where name = 's2'), 'marks', 50),
  jsonb_build_object('student_id', (select id from fx where name = 's3'), 'marks', 40)));
select throws_ok(
  $$update examination_subjects set full_marks = 80 where id = 'b0000000-0000-0000-0000-000000000001'$$,
  'P0001', 'MARKS_EXCEED_FULL', 'full marks cannot drop below marks already entered');
reset role;

-- ---------- Server-side results ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
create temporary table res on commit drop as
  select * from exam_section_results('a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a');
reset role;
select is((select total_obtained from res where student_id = (select id from fx where name = 's1')), 160.00::numeric, 's1 total is calculated');
select is((select percentage from res where student_id = (select id from fx where name = 's1')), 80.00::numeric, 's1 percentage is calculated');
select is((select gpa from res where student_id = (select id from fx where name = 's1')), 4.50::numeric, 's1 GPA is the average grade point');
select is((select grade from res where student_id = (select id from fx where name = 's1')), 'A', 'overall grade follows the GPA');
select is((select merit_position from res where student_id = (select id from fx where name = 's1')), 1, 's1 is first in merit');
select is((select passed from res where student_id = (select id from fx where name = 's2')), false, 'failing one subject fails the exam');
select is((select gpa from res where student_id = (select id from fx where name = 's2')), 0.00::numeric, 'GPA is 0 when a subject is failed');
select is((select total_obtained from res where student_id = (select id from fx where name = 's3')), 40.00::numeric, 'absent counts as zero under the default policy');
select is((select incomplete from res where student_id = (select id from fx where name = 's4')), true, 'a missing mark makes the result incomplete');
select is((select merit_position from res where student_id = (select id from fx where name = 's4')), null::int, 'incomplete results get no merit position');

-- ---------- Unpublished results stay private ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*)::int from student_marks), 0, 'students cannot see unpublished marks');
select throws_ok(
  $$select exam_report_card('a0000000-0000-0000-0000-000000000001', (select id from fx where name = 's1'))$$,
  '42501', null, 'students cannot open an unpublished report card');
reset role;

-- ---------- Review, approval, publication ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select set_exam_status('a0000000-0000-0000-0000-000000000001', 'under_review')$$, 'admin closes marks entry for review');
select throws_ok(
  $$select set_exam_status('a0000000-0000-0000-0000-000000000001', 'approved')$$,
  '42501', null, 'school admins cannot approve results');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select save_marks('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
     jsonb_build_array(jsonb_build_object('student_id', (select id from fx where name = 's2'), 'marks', 35)))$$,
  'P0001', 'EXAM_NOT_OPEN', 'teachers cannot change marks during review');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok($$select set_exam_status('a0000000-0000-0000-0000-000000000001', 'approved', 'Checked')$$, 'the principal approves the results');
select throws_ok(
  $$select set_exam_status('a0000000-0000-0000-0000-000000000001', 'draft')$$,
  'P0001', 'INVALID_TRANSITION', 'an approved exam cannot go back to draft');
select lives_ok($$select set_exam_status('a0000000-0000-0000-0000-000000000001', 'published')$$, 'the principal publishes the results');
reset role;
select is((select count(*)::int from result_publications where action = 'published'), 1, 'publication is recorded');
select is(
  (select array_agg(to_status::text order by id) from exam_status_history),
  array['marks_entry', 'under_review', 'approved', 'published'], 'every status change is recorded in order');

-- ---------- After publication ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(
  (select count(*)::int from student_marks where student_id = (select id from fx where name = 's1')), 2,
  'a student sees their own published marks');
select is((select count(*)::int from student_marks), 2, 'a student does not see classmates'' marks');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is(
  (exam_report_card('a0000000-0000-0000-0000-000000000001', (select id from fx where name = 's2')) -> 'result' ->> 'passed'),
  'false', 'a guardian can open their child''s published report card');
select throws_ok(
  $$select exam_report_card('a0000000-0000-0000-0000-000000000001', (select id from fx where name = 's1'))$$,
  '42501', null, 'a guardian cannot open another child''s report card');
reset role;

-- ---------- Correction after publication ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select request_marks_correction(
  (select id from student_marks where examination_subject_id = 'b0000000-0000-0000-0000-000000000001'
     and student_id = (select id from fx where name = 's2')),
  35, 'present', 'Re-checked script: 5 marks were not added');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok(
  $$select review_marks_correction((select id from marks_correction_requests limit 1), true, 'Verified')$$,
  'the principal approves the marks correction');
select is(
  (select passed from exam_section_results('a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a')
    where student_id = (select id from fx where name = 's2')),
  true, 'the corrected mark changes the calculated result');
reset role;

select * from finish();
rollback;
