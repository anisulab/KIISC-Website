-- Harness-only check: the sample data applies cleanly, works with the
-- admission workflow, and the removal script deletes it again.
begin;
select plan(26);

-- @include supabase/seed/sample_data.sql

select is((select count(*)::int from students where notes = 'SAMPLE RECORD'), 6, 'six sample students created');
select is((select count(*)::int from student_enrollments where section_id is not null), 6, 'sample students are placed in sections');
select is((select count(*)::int from teacher_assignments), 3, 'sample teaching assignments created');
select ok((select count(*) > 0 from student_marks), 'sample marks created');
select is((select count(*)::int from timetable_entries), 36, 'a full sample week is timetabled (6 days x 6 lessons)');
select is((select count(*)::int from fee_structures), 60, 'sample fee structures created for 15 classes x 4 categories');
select ok(
  (select count(*) > 0 from _exam_results(md5('kiisc-sample:exam:half-yearly-2026')::uuid,
     md5('kiisc-sample:section:2026:class-6:bangla_medium:A')::uuid)),
  'results can be calculated for the sample exam');
select is((select count(*)::int from get_public_faculty()), 0, 'sample teachers are not shown on the public website');
select is(
  (select string_agg(check_name, ', ') from integrity_report() where problems > 0 and check_name <> 'no_active_super_admin'),
  null, 'the sample data passes the integrity report (no super admin exists yet in a fresh database)');

select is((select count(*)::int from classes), 15, 'sample classes created');
select is((select count(*)::int from class_streams where medium = 'english_version'), 13, 'English Version offered up to Class 10');
select is((select count(*)::int from admission_document_types where is_required), 2, 'two required sample documents');
select is((select is_open from admission_settings), true, 'sample admission is open');

set local role service_role;
select is(
  (select submit_admission_application(
    jsonb_build_object(
      'academic_year_id', md5('kiisc-sample:year:2027')::uuid,
      'class_id', md5('kiisc-sample:class:class-6')::uuid,
      'medium', 'english_version',
      'student_name_en', 'Test Child', 'date_of_birth', current_date - interval '11 years', 'gender', 'female',
      'guardian_name', 'Test Parent', 'guardian_relationship', 'Mother', 'guardian_phone', '01812345678',
      'present_address', 'Dhaka 1236', 'permanent_address', 'Dhaka 1236'),
    jsonb_build_array(
      jsonb_build_object('document_type_id', md5('kiisc-sample:doctype:birth-certificate')::uuid, 'storage_path', 'applications/s1.pdf',
                         'file_name', 'b.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10),
      jsonb_build_object('document_type_id', md5('kiisc-sample:doctype:student-photo')::uuid, 'storage_path', 'applications/s2.jpg',
                         'file_name', 'p.jpg', 'mime_type', 'image/jpeg', 'size_bytes', 10))
  ) ->> 'reference_no'),
  'KI-APP-2027-00001', 'an application can be submitted against the sample setup');
reset role;

-- Remove the test application, then the sample data.
delete from admission_applications;
-- @include supabase/seed/remove_sample_data.sql

select is((select count(*)::int from students), 0, 'sample students removed');
select is((select count(*)::int from teachers), 0, 'sample teachers removed');
select is((select count(*)::int from examinations), 0, 'sample examination removed');
select is((select count(*)::int from timetable_entries), 0, 'sample timetable removed');
select is((select count(*)::int from fee_structures), 0, 'sample fee structures removed');
select is((select count(*)::int from fee_categories), 0, 'sample fee categories removed');
select is((select count(*)::int from holidays), 0, 'sample holidays removed');
select is((select count(*)::int from guardians), 0, 'sample guardians removed');
select is((select count(*)::int from classes), 0, 'sample classes removed');
select is((select count(*)::int from subjects), 0, 'sample subjects removed');
select is((select count(*)::int from notices), 0, 'sample notices removed');
select is((select is_open from admission_settings), false, 'admission closed again after removal');

select * from finish();
rollback;
