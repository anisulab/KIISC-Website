-- Removes the rows created by sample_data.sql that are still unchanged in
-- their identifying key (see the id convention described there).
-- If a real admission application references a sample class or year, the
-- delete stops with a foreign-key error: replace that class/year first.
begin;

-- Sample students (and guardians used only by them).
create temporary table _sample_students on commit drop as
  select id from public.students where notes = 'SAMPLE RECORD';
create temporary table _sample_guardians on commit drop as
  select distinct sg.guardian_id as id from public.student_guardians sg join _sample_students s on s.id = sg.student_id;
-- Finance records of sample students (sample data only), then sample fee setup.
delete from public.payment_allocations a using public.payments p
where p.id = a.payment_id and p.student_id in (select id from _sample_students);
delete from public.payments where student_id in (select id from _sample_students);
delete from public.invoice_items where student_id in (select id from _sample_students);
delete from public.student_invoices where student_id in (select id from _sample_students);
delete from public.student_discounts where student_id in (select id from _sample_students);
delete from public.fee_structures f using public.classes c
where c.id = f.class_id and f.id = md5('kiisc-sample:fee:2026:' || c.code || ':' ||
      (select code from public.fee_categories where id = f.fee_category_id))::uuid
  and not exists (select 1 from public.invoice_items it where it.fee_structure_id = f.id);
delete from public.fee_categories fc
where fc.id = md5('kiisc-sample:fee-category:' || fc.code)::uuid
  and not exists (select 1 from public.fee_structures f where f.fee_category_id = fc.id)
  and not exists (select 1 from public.invoice_items it where it.fee_category_id = fc.id);

-- Sample examination (and any marks on it), then marks of sample students.
select set_config('app.status_change', 'on', true);
delete from public.marks_correction_requests c using public.student_marks m
where m.id = c.mark_id
  and (m.student_id in (select id from _sample_students)
       or m.examination_subject_id in (select id from public.examination_subjects where examination_id = md5('kiisc-sample:exam:half-yearly-2026')::uuid));
delete from public.student_marks m
where m.student_id in (select id from _sample_students)
   or m.examination_subject_id in (select id from public.examination_subjects where examination_id = md5('kiisc-sample:exam:half-yearly-2026')::uuid);
delete from public.result_publications where examination_id = md5('kiisc-sample:exam:half-yearly-2026')::uuid;
delete from public.exam_status_history where examination_id = md5('kiisc-sample:exam:half-yearly-2026')::uuid;
delete from public.examination_subjects where examination_id = md5('kiisc-sample:exam:half-yearly-2026')::uuid;
delete from public.examinations where id = md5('kiisc-sample:exam:half-yearly-2026')::uuid;
delete from public.grading_schemes gs
where gs.id = md5('kiisc-sample:scheme:bd')::uuid
  and not exists (select 1 from public.examinations e where e.grading_scheme_id = gs.id);
select set_config('app.status_change', '', true);

delete from public.attendance_correction_requests where student_id in (select id from _sample_students);
delete from public.attendance_records where student_id in (select id from _sample_students);
delete from public.attendance_sessions a where not exists (select 1 from public.attendance_records r where r.session_id = a.id);
delete from public.student_documents where student_id in (select id from _sample_students);
delete from public.student_enrollments where student_id in (select id from _sample_students);
delete from public.student_guardians where student_id in (select id from _sample_students);
delete from public.students where id in (select id from _sample_students);
delete from public.guardians g where g.id in (select id from _sample_guardians)
  and not exists (select 1 from public.student_guardians sg where sg.guardian_id = g.id);

-- Sample timetable, periods and resource.
delete from public.timetable_entries te
where te.id = md5('kiisc-sample:tt:' || te.weekday || ':' || te.period_no)::uuid;
delete from public.timetable_periods tp
where tp.id = md5('kiisc-sample:period:2026:' || tp.period_no)::uuid
  and not exists (select 1 from public.timetable_entries te where te.academic_year_id = tp.academic_year_id and te.period_no = tp.period_no);
delete from public.learning_resources where id = md5('kiisc-sample:resource:nctb')::uuid;

-- Sample teachers, their assignments and sample holidays.
delete from public.teacher_assignments ta
where ta.id in (select md5('kiisc-sample:assignment:' || k)::uuid from unnest(array['ct-6a', 'ct-9a', 'math-6a']) k);
delete from public.teachers t
where t.id in (select md5('kiisc-sample:teacher:' || k)::uuid from unnest(array['t1', 't2', 't3']) k)
  and not exists (select 1 from public.teacher_assignments ta where ta.teacher_id = t.id);
delete from public.holidays h where h.id = md5('kiisc-sample:holiday:' || h.starts_on::text)::uuid;

delete from public.notices n where n.id in (
  select md5('kiisc-sample:notice:' || k)::uuid from unnest(array['admission-2027', 'annual-exam', 'victory-day']) k);
delete from public.events e where e.id in (
  select md5('kiisc-sample:event:' || k)::uuid
  from unnest(array['parents-meeting', 'annual-sports', 'victory-day', 'annual-exam']) k);

delete from public.class_subjects cs using public.classes c, public.subjects s
where c.id = cs.class_id and s.id = cs.subject_id
  and cs.id = md5('kiisc-sample:class-subject:' || c.code || ':' || cs.medium || ':' || s.code)::uuid;

delete from public.sections se using public.classes c, public.academic_years y
where c.id = se.class_id and y.id = se.academic_year_id
  and se.id = md5('kiisc-sample:section:' || y.code || ':' || c.code || ':' || se.medium || ':' || se.name)::uuid
  and not exists (select 1 from public.student_enrollments e where e.section_id = se.id);

delete from public.class_streams cs using public.classes c
where c.id = cs.class_id and c.id = md5('kiisc-sample:class:' || c.code)::uuid
  and not exists (select 1 from public.sections se where se.class_id = cs.class_id and se.medium = cs.medium)
  and not exists (select 1 from public.class_subjects x where x.class_id = cs.class_id and x.medium = cs.medium);

delete from public.classes c
where c.id = md5('kiisc-sample:class:' || c.code)::uuid
  and not exists (select 1 from public.class_streams cs where cs.class_id = c.id);

delete from public.subjects s
where s.id = md5('kiisc-sample:subject:' || s.code)::uuid
  and not exists (select 1 from public.class_subjects cs where cs.subject_id = s.id);

delete from public.admission_document_types d
where d.id = md5('kiisc-sample:doctype:' || d.code)::uuid
  and not exists (select 1 from public.application_documents ad where ad.document_type_id = d.id);

delete from public.academic_terms t using public.academic_years y
where y.id = t.academic_year_id and t.id = md5('kiisc-sample:term:' || y.code || ':' || t.name_en)::uuid;

delete from public.academic_years y
where y.id = md5('kiisc-sample:year:' || y.code)::uuid
  and not exists (select 1 from public.academic_terms t where t.academic_year_id = y.id)
  and not exists (select 1 from public.sections se where se.academic_year_id = y.id);

update public.admission_settings set
  is_open = false,
  instructions_en = null, instructions_bn = null,
  eligibility_en = null, eligibility_bn = null
where id and coalesce(instructions_en, '') like 'SAMPLE TEXT:%';

update public.institution_settings set office_hours_en = null, office_hours_bn = null
where id and coalesce(office_hours_en, '') like 'SAMPLE:%';

commit;
