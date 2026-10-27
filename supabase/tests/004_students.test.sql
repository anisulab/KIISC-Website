-- pgTAP tests for Stage 4 (students, guardians, enrollments). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(34);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'officer@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'parent1@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'parent2@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'student1@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'admission_officer'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f1', 'guardian'),
  ('00000000-0000-0000-0000-0000000000f2', 'guardian'),
  ('00000000-0000-0000-0000-0000000000c1', 'student');

insert into academic_years (id, code, name_en, starts_on, ends_on) values
  ('10000000-0000-0000-0000-000000000027', '2027', 'AY 2027', '2027-01-01', '2027-12-31'),
  ('10000000-0000-0000-0000-000000000028', '2028', 'AY 2028', '2028-01-01', '2028-12-31');
insert into classes (id, code, name_en, level) values
  ('20000000-0000-0000-0000-000000000006', 'class-6', 'Class 6', 6),
  ('20000000-0000-0000-0000-000000000007', 'class-7', 'Class 7', 7),
  ('20000000-0000-0000-0000-000000000008', 'class-8', 'Class 8', 8);
insert into class_streams (class_id, medium) values
  ('20000000-0000-0000-0000-000000000006', 'bangla_medium'),
  ('20000000-0000-0000-0000-000000000007', 'bangla_medium');
insert into sections (id, academic_year_id, class_id, medium, name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000006', 'bangla_medium', 'A'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000028', '20000000-0000-0000-0000-000000000007', 'bangla_medium', 'A');
insert into admission_document_types (id, code, name_en) values ('30000000-0000-0000-0000-000000000001', 'birth-certificate', 'Birth certificate');

insert into admission_applications (id, reference_no, academic_year_id, class_id, medium, student_name_en, date_of_birth, gender,
  guardian_name, guardian_relationship, guardian_phone, present_address, permanent_address, status) values
  ('50000000-0000-0000-0000-000000000001', 'KI-APP-2027-00001', '10000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000006',
   'bangla_medium', 'Rahim Uddin', '2015-03-14', 'male', 'Karim Uddin', 'Father', '01712345678', 'Jatrabari, Dhaka', 'Jatrabari, Dhaka', 'approved'),
  ('50000000-0000-0000-0000-000000000002', 'KI-APP-2027-00002', '10000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000006',
   'bangla_medium', 'Pending Child', '2015-05-01', 'female', 'Some Parent', 'Mother', '01812345678', 'Dhaka 1236', 'Dhaka 1236', 'under_review');
insert into application_documents (application_id, document_type_id, storage_path, file_name, mime_type, size_bytes) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'applications/a1.pdf', 'birth.pdf', 'application/pdf', 1000);

-- ---------- Admission → student (admission officer) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok(
  $$select admit_applicant('50000000-0000-0000-0000-000000000002')$$,
  'P0001', 'APPLICATION_NOT_APPROVED', 'only approved applications can be admitted');
select lives_ok(
  $$select admit_applicant('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '2027-01-05', true)$$,
  'an approved applicant can be admitted');
select is(
  admit_applicant('50000000-0000-0000-0000-000000000001'),
  (select id from students where application_id = '50000000-0000-0000-0000-000000000001'),
  'admitting the same application again returns the existing student');
select throws_ok(
  $$select create_student('{}'::jsonb)$$,
  '42501', null, 'admission officers cannot add students outside the admission process');
reset role;

select is((select count(*)::int from students), 1, 'repeated admission does not create duplicate students');
select is((select student_code from students), 'KI20270001', 'student ID is generated');
select is((select admission_no from students), 'KI-ADM-2027-00001', 'admission number is generated');
select is((select status::text from admission_applications where id = '50000000-0000-0000-0000-000000000001'), 'admitted', 'application is marked admitted');
select is(
  (select verified_by from student_guardians),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'the guardian link records who verified it');
select is((select count(*)::int from student_documents where bucket = 'admission-documents'), 1, 'admission documents are attached to the student record');
select is((select section_id from student_enrollments), '40000000-0000-0000-0000-000000000001'::uuid, 'the student is enrolled in the chosen section');

-- ---------- Portal links (as the database owner) ----------
update guardians set user_id = '00000000-0000-0000-0000-0000000000f1';
update students set user_id = '00000000-0000-0000-0000-0000000000c1';
insert into guardians (id, name, phone, user_id) values
  ('60000000-0000-0000-0000-000000000002', 'Claimed Parent', '01912345678', '00000000-0000-0000-0000-0000000000f2');
insert into student_guardians (student_id, guardian_id, relationship)
  select id, '60000000-0000-0000-0000-000000000002', 'Uncle' from students;  -- not verified

-- ---------- Manual student by a school admin ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select create_student(jsonb_build_object(
    'academic_year_id', '10000000-0000-0000-0000-000000000027', 'class_id', '20000000-0000-0000-0000-000000000006',
    'medium', 'bangla_medium', 'name_en', 'Existing Student', 'date_of_birth', '2015-01-01',
    'guardian_name', 'Existing Parent', 'guardian_relationship', 'Mother', 'guardian_phone', '01612345678')) ->> 'student_code'),
  'KI20270002', 'existing students can be added and continue the ID sequence');
select is(
  link_guardian((select id from students where student_code = 'KI20270002'), 'Karim Uddin', '+8801712345678', null, 'Uncle'),
  (select guardian_id from student_guardians sg join students s on s.id = sg.student_id where s.student_code = 'KI20270001' and sg.is_primary),
  'linking reuses an existing guardian with the same name and phone (siblings)');
select is(
  (select verified_at from student_guardians sg join students s on s.id = sg.student_id
    where s.student_code = 'KI20270002' and sg.relationship = 'Uncle'),
  null::timestamptz, 'manually linked guardians start unverified');
select throws_ok(
  $$update students set status = 'withdrawn' where student_code = 'KI20270002'$$,
  'P0001', 'USE_STATUS_FUNCTION', 'status cannot be changed by direct edit');
select throws_ok(
  $$update students set student_code = 'X1' where student_code = 'KI20270002'$$,
  'P0001', 'IMMUTABLE_FIELD', 'student IDs cannot be changed');
select throws_ok(
  $$update student_enrollments set section_id = '40000000-0000-0000-0000-000000000002'
    where student_id = (select id from students where student_code = 'KI20270002')$$,
  'P0001', 'SECTION_MISMATCH', 'a section from another year or class is rejected');
select throws_ok(
  $$delete from students where student_code = 'KI20270002'$$,
  '42501', null, 'student records cannot be deleted');
select throws_ok(
  $$select change_student_status((select id from students where student_code = 'KI20270002'), 'withdrawn')$$,
  'P0001', 'REASON_REQUIRED', 'leaving requires a reason');
select lives_ok(
  $$select change_student_status((select id from students where student_code = 'KI20270002'), 'withdrawn', '2027-03-01', 'Family moved')$$,
  'a student can be withdrawn with a reason');
select is(
  (select e.status::text from student_enrollments e join students s on s.id = e.student_id where s.student_code = 'KI20270002'),
  'withdrawn', 'withdrawal closes the open enrollment');

-- ---------- Year-end promotion ----------
select throws_ok(
  $$select promote_students('10000000-0000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000028',
    jsonb_build_array(jsonb_build_object('student_id', (select id from students where student_code = 'KI20270001'),
      'action', 'promote', 'class_id', '20000000-0000-0000-0000-000000000008')))$$,
  'P0001', 'INVALID_CLASS', 'promotion into a class not offered in the stream is rejected');
select is(
  promote_students('10000000-0000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000028',
    jsonb_build_array(jsonb_build_object('student_id', (select id from students where student_code = 'KI20270001'),
      'action', 'promote', 'class_id', '20000000-0000-0000-0000-000000000007', 'section_id', '40000000-0000-0000-0000-000000000002'))),
  1, 'a student can be promoted to the next year');
select throws_ok(
  $$select promote_students('10000000-0000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000028',
    jsonb_build_array(jsonb_build_object('student_id', (select id from students where student_code = 'KI20270001'),
      'action', 'promote', 'class_id', '20000000-0000-0000-0000-000000000007')))$$,
  'P0001', 'NOT_ENROLLED', 'a student cannot be promoted twice from the same year');
reset role;

select is(
  (select array_agg(e.status::text order by y.starts_on) from student_enrollments e
     join academic_years y on y.id = e.academic_year_id join students s on s.id = e.student_id
    where s.student_code = 'KI20270001'),
  array['promoted', 'enrolled'], 'promotion keeps the previous year''s enrollment as history');

-- ---------- Who can see what ----------
set local role anon;
select throws_ok($$select count(*) from students$$, '42501', null, 'anonymous visitors cannot query students at all');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from students), 0, 'teachers without assignments see no students');
select throws_ok(
  $$select promote_students('10000000-0000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000028', '[]')$$,
  '42501', null, 'teachers cannot run promotions');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from students), 2, 'the principal can view all students');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from students), 1, 'a guardian sees only their verified child');
select is((select count(*)::int from student_enrollments), 2, 'a guardian sees their child''s enrollment history');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is((select count(*)::int from students), 0, 'an unverified guardian link grants no access');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select student_code from students), 'KI20270001', 'a student sees only their own record');
select is((select count(*)::int from student_documents), 0, 'students cannot see document records');
reset role;

select * from finish();
rollback;
