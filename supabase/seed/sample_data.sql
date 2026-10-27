-- =====================================================================
-- SAMPLE DATA: illustrative placeholders only, NOT institutional facts.
-- Lets the website and admin console be explored before real data exists.
--
-- Apply: run this file once in the Lovable Cloud SQL editor (after migrations).
-- Remove: run supabase/seed/remove_sample_data.sql.
--
-- Every sample row's id is md5('kiisc-sample:<kind>:<natural key>')::uuid.
-- The removal script deletes only rows whose id still matches their own key,
-- so anything you edit into real data (e.g. a renamed class code) is kept.
-- =====================================================================

-- ---------- Academic years & terms ----------
insert into public.academic_years (id, code, name_en, name_bn, starts_on, ends_on, is_current, admission_open) values
  (md5('kiisc-sample:year:2026')::uuid, '2026', 'Academic Year 2026', 'শিক্ষাবর্ষ ২০২৬', '2026-01-01', '2026-12-31', true, false),
  (md5('kiisc-sample:year:2027')::uuid, '2027', 'Academic Year 2027', 'শিক্ষাবর্ষ ২০২৭', '2027-01-01', '2027-12-31', false, true)
on conflict (code) do nothing;

insert into public.academic_terms (id, academic_year_id, name_en, name_bn, starts_on, ends_on, sort_order)
select md5('kiisc-sample:term:' || y.code || ':' || t.name_en)::uuid, y.id, t.name_en, t.name_bn,
       make_date(y.code::int, t.m1, 1), make_date(y.code::int, t.m2, t.d2), t.ord
from public.academic_years y
cross join (values
  ('First Term', 'প্রথম সাময়িক', 1, 6, 30, 1),
  ('Second Term', 'দ্বিতীয় সাময়িক', 7, 12, 31, 2)
) as t(name_en, name_bn, m1, m2, d2, ord)
where y.id = md5('kiisc-sample:year:' || y.code)::uuid
on conflict do nothing;

-- ---------- Classes ----------
insert into public.classes (id, code, name_en, name_bn, level)
select md5('kiisc-sample:class:' || c.code)::uuid, c.code, c.name_en, c.name_bn, c.level
from (values
  ('play', 'Play', 'প্লে', -2),
  ('nursery', 'Nursery', 'নার্সারি', -1),
  ('kg', 'KG', 'কেজি', 0),
  ('class-1', 'Class 1', 'প্রথম শ্রেণি', 1),
  ('class-2', 'Class 2', 'দ্বিতীয় শ্রেণি', 2),
  ('class-3', 'Class 3', 'তৃতীয় শ্রেণি', 3),
  ('class-4', 'Class 4', 'চতুর্থ শ্রেণি', 4),
  ('class-5', 'Class 5', 'পঞ্চম শ্রেণি', 5),
  ('class-6', 'Class 6', 'ষষ্ঠ শ্রেণি', 6),
  ('class-7', 'Class 7', 'সপ্তম শ্রেণি', 7),
  ('class-8', 'Class 8', 'অষ্টম শ্রেণি', 8),
  ('class-9', 'Class 9', 'নবম শ্রেণি', 9),
  ('class-10', 'Class 10', 'দশম শ্রেণি', 10),
  ('class-11', 'Class XI (HSC 1st Year)', 'একাদশ শ্রেণি', 11),
  ('class-12', 'Class XII (HSC 2nd Year)', 'দ্বাদশ শ্রেণি', 12)
) as c(code, name_en, name_bn, level)
on conflict (code) do nothing;

-- Bangla Medium: all classes. English Version: Play to Class 10.
-- Admission open for all except board-exam years (Class 10, Class XII).
insert into public.class_streams (class_id, medium, admission_open)
select c.id, s.medium, c.code not in ('class-10', 'class-12')
from public.classes c
cross join (values ('bangla_medium'::public.education_medium), ('english_version'::public.education_medium)) as s(medium)
where c.id = md5('kiisc-sample:class:' || c.code)::uuid
  and (s.medium = 'bangla_medium' or c.level <= 10)
on conflict do nothing;

-- ---------- Sections (2026 and 2027) ----------
insert into public.sections (id, academic_year_id, class_id, medium, name, capacity)
select md5('kiisc-sample:section:' || y.code || ':' || c.code || ':' || cs.medium || ':' || n.name)::uuid,
       y.id, c.id, cs.medium, n.name, 40
from public.class_streams cs
join public.classes c on c.id = cs.class_id and c.id = md5('kiisc-sample:class:' || c.code)::uuid
cross join public.academic_years y
cross join (values ('A'), ('B')) as n(name)
where y.id = md5('kiisc-sample:year:' || y.code)::uuid
  and (n.name = 'A' or cs.medium = 'bangla_medium')
on conflict do nothing;

-- ---------- Subjects ----------
insert into public.subjects (id, code, name_en, name_bn)
select md5('kiisc-sample:subject:' || s.code)::uuid, s.code, s.name_en, s.name_bn
from (values
  ('bangla', 'Bangla', 'বাংলা'),
  ('english', 'English', 'ইংরেজি'),
  ('mathematics', 'Mathematics', 'গণিত'),
  ('science', 'Science', 'বিজ্ঞান'),
  ('bgs', 'Bangladesh & Global Studies', 'বাংলাদেশ ও বিশ্বপরিচয়'),
  ('religion', 'Religion & Moral Education', 'ধর্ম ও নৈতিক শিক্ষা'),
  ('ict', 'Information & Communication Technology', 'তথ্য ও যোগাযোগ প্রযুক্তি'),
  ('physics', 'Physics', 'পদার্থবিজ্ঞান'),
  ('chemistry', 'Chemistry', 'রসায়ন'),
  ('biology', 'Biology', 'জীববিজ্ঞান'),
  ('higher-math', 'Higher Mathematics', 'উচ্চতর গণিত'),
  ('arts-crafts', 'Arts & Crafts', 'চারু ও কারুকলা')
) as s(code, name_en, name_bn)
on conflict (code) do nothing;

-- Same sample curriculum in both streams (configure each stream separately later).
insert into public.class_subjects (id, class_id, medium, subject_id, is_optional, sort_order)
select md5('kiisc-sample:class-subject:' || c.code || ':' || cs.medium || ':' || s.code)::uuid,
       c.id, cs.medium, s.id, m.optional, m.ord
from public.class_streams cs
join public.classes c on c.id = cs.class_id and c.id = md5('kiisc-sample:class:' || c.code)::uuid
join (values
  ('bangla', -2, 12, false, 1), ('english', -2, 12, false, 2), ('mathematics', -2, 10, false, 3),
  ('arts-crafts', -2, 5, false, 9),
  ('science', 3, 8, false, 4), ('bgs', 3, 10, false, 5), ('religion', 1, 12, false, 6),
  ('ict', 6, 12, false, 7),
  ('physics', 9, 12, false, 10), ('chemistry', 9, 12, false, 11), ('biology', 9, 12, false, 12),
  ('higher-math', 9, 12, true, 13)
) as m(code, from_level, to_level, optional, ord) on c.level between m.from_level and m.to_level
join public.subjects s on s.code = m.code and s.id = md5('kiisc-sample:subject:' || s.code)::uuid
on conflict do nothing;

-- ---------- Admissions ----------
insert into public.admission_document_types (id, code, name_en, name_bn, description_en, description_bn, is_required, sort_order)
select md5('kiisc-sample:doctype:' || d.code)::uuid, d.code, d.name_en, d.name_bn, d.desc_en, d.desc_bn, d.req, d.ord
from (values
  ('birth-certificate', 'Birth registration certificate', 'জন্ম নিবন্ধন সনদ', 'Online birth registration copy (PDF or photo).', 'অনলাইন জন্ম নিবন্ধনের কপি (PDF বা ছবি)।', true, 1),
  ('student-photo', 'Student photograph', 'শিক্ষার্থীর ছবি', 'Recent passport-size colour photo.', 'সাম্প্রতিক পাসপোর্ট সাইজের রঙিন ছবি।', true, 2),
  ('guardian-nid', 'Guardian''s NID', 'অভিভাবকের জাতীয় পরিচয়পত্র', 'Front and back in one file.', 'সামনে ও পেছনে এক ফাইলে।', false, 3),
  ('previous-result', 'Previous school result', 'পূর্ববর্তী স্কুলের ফলাফল', 'Latest report card, if applicable.', 'সর্বশেষ রিপোর্ট কার্ড (প্রযোজ্য হলে)।', false, 4),
  ('transfer-certificate', 'Transfer certificate', 'ছাড়পত্র (টিসি)', 'If transferring from another school.', 'অন্য স্কুল থেকে এলে।', false, 5)
) as d(code, name_en, name_bn, desc_en, desc_bn, req, ord)
on conflict (code) do nothing;

update public.admission_settings set
  is_open = true,
  instructions_en = 'SAMPLE TEXT: Fill in all required fields and upload clear copies of the required documents. After submission, keep your application reference number to check the status.',
  instructions_bn = 'নমুনা লেখা: সকল আবশ্যক ঘর পূরণ করুন এবং প্রয়োজনীয় কাগজপত্রের স্পষ্ট কপি আপলোড করুন। আবেদন জমার পর স্ট্যাটাস জানতে রেফারেন্স নম্বরটি সংরক্ষণ করুন।',
  eligibility_en = 'SAMPLE TEXT: Play: age 3+ · Nursery: 4+ · KG: 5+ · Class 1: 6+ on 1 January of the admission year. Higher classes: pass in the previous class.',
  eligibility_bn = 'নমুনা লেখা: প্লে: ৩+ বছর · নার্সারি: ৪+ · কেজি: ৫+ · প্রথম শ্রেণি: ভর্তির বছরের ১ জানুয়ারিতে ৬+ বছর। উচ্চতর শ্রেণি: পূর্ববর্তী শ্রেণিতে উত্তীর্ণ।'
where id;

update public.institution_settings set
  office_hours_en = 'SAMPLE: Saturday – Thursday, 8:00 AM – 3:00 PM',
  office_hours_bn = 'নমুনা: শনিবার – বৃহস্পতিবার, সকাল ৮:০০ – বিকাল ৩:০০'
where id and office_hours_en is null;

-- ---------- Students (current sample year 2026) ----------
-- Created through the same function the admin console uses; marked by notes = 'SAMPLE RECORD'.
do $$
declare
  r record;
  v_id uuid;
begin
  if exists (select 1 from public.students where notes = 'SAMPLE RECORD') then return; end if;
  for r in
    select * from (values
      ('Arif Hossain', 'আরিফ হোসেন', date '2014-02-11', 'male', 'class-6', 'bangla_medium', 'A', 1, 'Delwar Hossain', 'Father', '01710000001'),
      ('Nusrat Jahan', 'নুসরাত জাহান', date '2014-07-23', 'female', 'class-6', 'bangla_medium', 'A', 2, 'Rokeya Begum', 'Mother', '01710000002'),
      ('Tanvir Ahmed', 'তানভীর আহমেদ', date '2014-05-02', 'male', 'class-6', 'english_version', 'A', 1, 'Shafiq Ahmed', 'Father', '01710000003'),
      ('Farhana Islam', 'ফারহানা ইসলাম', date '2011-09-14', 'female', 'class-9', 'bangla_medium', 'A', 1, 'Nazrul Islam', 'Father', '01710000004'),
      ('Sabbir Rahman', 'সাব্বির রহমান', date '2011-12-30', 'male', 'class-9', 'bangla_medium', 'B', 1, 'Hasina Rahman', 'Mother', '01710000005'),
      ('Mim Akter', 'মিম আক্তার', date '2019-04-18', 'female', 'class-1', 'english_version', 'A', 1, 'Selina Akter', 'Mother', '01710000006')
    ) as s(name_en, name_bn, dob, gender, class_code, medium, section, roll, g_name, g_rel, g_phone)
  loop
    v_id := public._create_student(
      md5('kiisc-sample:year:2026')::uuid,
      md5('kiisc-sample:class:' || r.class_code)::uuid,
      r.medium::public.education_medium,
      md5('kiisc-sample:section:2026:' || r.class_code || ':' || r.medium || ':' || r.section)::uuid,
      r.roll, r.name_en, r.name_bn, r.dob, r.gender::public.gender, date '2026-01-02',
      null, 'Jatrabari, Dhaka-1236', 'Jatrabari, Dhaka-1236', null,
      r.g_name, r.g_rel, r.g_phone, null, true
    );
    update public.students set notes = 'SAMPLE RECORD' where id = v_id;
  end loop;
end $$;

-- ---------- Teachers, assignments, holidays ----------
-- Sample teachers are NOT shown on the public website (show_on_website = false).
insert into public.teachers (id, name_en, name_bn, designation_en, designation_bn, phone, joined_on)
select md5('kiisc-sample:teacher:' || t.key)::uuid, t.name_en, t.name_bn, t.des_en, t.des_bn, t.phone, date '2020-01-01'
from (values
  ('t1', 'Md. Rafiqul Islam', 'মো. রফিকুল ইসলাম', 'Senior Teacher', 'সিনিয়র শিক্ষক', '01810000001'),
  ('t2', 'Shirin Akter', 'শিরিন আক্তার', 'Assistant Teacher', 'সহকারী শিক্ষক', '01810000002'),
  ('t3', 'Abdul Karim', 'আব্দুল করিম', 'Assistant Teacher', 'সহকারী শিক্ষক', '01810000003')
) as t(key, name_en, name_bn, des_en, des_bn, phone)
on conflict (id) do nothing;

insert into public.teacher_assignments (id, teacher_id, section_id, role, subject_id)
select md5('kiisc-sample:assignment:' || a.key)::uuid, md5('kiisc-sample:teacher:' || a.teacher)::uuid,
       md5('kiisc-sample:section:2026:' || a.class_code || ':bangla_medium:A')::uuid, a.role::public.assignment_role,
       case when a.subject is null then null else md5('kiisc-sample:subject:' || a.subject)::uuid end
from (values
  ('ct-6a', 't1', 'class-6', 'class_teacher', null),
  ('ct-9a', 't2', 'class-9', 'class_teacher', null),
  ('math-6a', 't3', 'class-6', 'subject_teacher', 'mathematics')
) as a(key, teacher, class_code, role, subject)
on conflict do nothing;

insert into public.holidays (id, starts_on, ends_on, name_en, name_bn)
select md5('kiisc-sample:holiday:' || h.d)::uuid, h.d::date, null, h.name_en, h.name_bn
from (values
  ('2026-12-16', 'Victory Day', 'বিজয় দিবস'),
  ('2027-02-21', 'International Mother Language Day', 'আন্তর্জাতিক মাতৃভাষা দিবস'),
  ('2027-03-26', 'Independence Day', 'স্বাধীনতা দিবস')
) as h(d, name_en, name_bn)
on conflict do nothing;

-- ---------- Grading scheme & a sample examination ----------
-- Grade bands follow the common Bangladesh national scale; confirm the school's own policy.
insert into public.grading_schemes (id, name_en, name_bn, overall_method, fail_in_any_subject_fails)
values (md5('kiisc-sample:scheme:bd')::uuid, 'Standard GPA scale (sample)', 'প্রচলিত জিপিএ স্কেল (নমুনা)', 'gpa', true)
on conflict (id) do nothing;

insert into public.grade_rules (id, scheme_id, grade, min_percent, max_percent, grade_point, is_fail)
select md5('kiisc-sample:grade:' || g.grade)::uuid, md5('kiisc-sample:scheme:bd')::uuid, g.grade, g.lo, g.hi, g.gp, g.fail
from (values
  ('A+', 80, 100, 5.00, false), ('A', 70, 79.99, 4.00, false), ('A-', 60, 69.99, 3.50, false),
  ('B', 50, 59.99, 3.00, false), ('C', 40, 49.99, 2.00, false), ('D', 33, 39.99, 1.00, false),
  ('F', 0, 32.99, 0.00, true)
) as g(grade, lo, hi, gp, fail)
on conflict do nothing;

insert into public.examinations (id, academic_year_id, term_id, name_en, name_bn, grading_scheme_id, starts_on, ends_on)
values (md5('kiisc-sample:exam:half-yearly-2026')::uuid, md5('kiisc-sample:year:2026')::uuid,
        md5('kiisc-sample:term:2026:First Term')::uuid, '[Sample] Half-Yearly Examination 2026', '[নমুনা] অর্ধবার্ষিক পরীক্ষা ২০২৬',
        md5('kiisc-sample:scheme:bd')::uuid, '2026-06-10', '2026-06-25')
on conflict (id) do nothing;

insert into public.examination_subjects (id, examination_id, class_id, medium, subject_id, full_marks, pass_marks, sort_order)
select md5('kiisc-sample:exam-subject:' || cs.id)::uuid, md5('kiisc-sample:exam:half-yearly-2026')::uuid,
       cs.class_id, cs.medium, cs.subject_id, 100, 33, cs.sort_order
from public.class_subjects cs
join public.classes c on c.id = cs.class_id
where c.code in ('class-6', 'class-9') and cs.id = md5('kiisc-sample:class-subject:' || c.code || ':' || cs.medium || ':' ||
      (select code from public.subjects where id = cs.subject_id))::uuid
on conflict do nothing;

-- Open marks entry and add illustrative marks for the sample students.
do $$
begin
  if (select status from public.examinations where id = md5('kiisc-sample:exam:half-yearly-2026')::uuid) = 'draft' then
    perform set_config('app.status_change', 'on', true);
    update public.examinations set status = 'marks_entry' where id = md5('kiisc-sample:exam:half-yearly-2026')::uuid;
    perform set_config('app.status_change', '', true);
  end if;
end $$;

insert into public.student_marks (examination_subject_id, student_id, section_id, marks)
select es.id, s.id, e.section_id, 35 + (abs(hashtext(s.student_code || es.subject_id::text)) % 64)
from public.students s
join public.student_enrollments e on e.student_id = s.id and e.academic_year_id = md5('kiisc-sample:year:2026')::uuid
join public.examination_subjects es on es.examination_id = md5('kiisc-sample:exam:half-yearly-2026')::uuid
  and es.class_id = e.class_id and es.medium = e.medium
where s.notes = 'SAMPLE RECORD' and e.section_id is not null
on conflict do nothing;

-- ---------- Fees (SAMPLE AMOUNTS — replace with the school's approved fees) ----------
insert into public.fee_categories (id, code, name_en, name_bn)
select md5('kiisc-sample:fee-category:' || c.code)::uuid, c.code, c.name_en, c.name_bn
from (values
  ('admission', 'Admission fee (sample)', 'ভর্তি ফি (নমুনা)'),
  ('tuition', 'Monthly tuition fee (sample)', 'মাসিক বেতন (নমুনা)'),
  ('exam', 'Examination fee (sample)', 'পরীক্ষার ফি (নমুনা)'),
  ('session', 'Session fee (sample)', 'সেশন ফি (নমুনা)')
) as c(code, name_en, name_bn)
on conflict do nothing;

insert into public.fee_structures (id, academic_year_id, class_id, medium, fee_category_id, amount, frequency, late_fee_amount, late_fee_after_days)
select md5('kiisc-sample:fee:2026:' || c.code || ':' || f.code)::uuid, md5('kiisc-sample:year:2026')::uuid, c.id, null,
       md5('kiisc-sample:fee-category:' || f.code)::uuid,
       case f.code when 'tuition' then 1000 + greatest(c.level, 0) * 100 when 'admission' then 3000 when 'exam' then 500 else 2000 end,
       f.freq::public.fee_frequency,
       case when f.code = 'tuition' then 50 else 0 end,
       case when f.code = 'tuition' then 10 end
from public.classes c
cross join (values ('admission', 'one_time'), ('tuition', 'monthly'), ('exam', 'per_exam'), ('session', 'yearly')) as f(code, freq)
where c.id = md5('kiisc-sample:class:' || c.code)::uuid
on conflict do nothing;

insert into public.student_discounts (id, student_id, academic_year_id, fee_category_id, kind, value, reason)
select md5('kiisc-sample:discount:' || s.student_code)::uuid, s.id, md5('kiisc-sample:year:2026')::uuid,
       md5('kiisc-sample:fee-category:tuition')::uuid, 'percent', 25, 'Sample: sibling discount'
from public.students s
where s.notes = 'SAMPLE RECORD' and s.name_en = 'Nusrat Jahan'
on conflict do nothing;

-- ---------- Timetable & learning resources (Class 6, Bangla Medium, Section A, 2026) ----------
insert into public.timetable_periods (id, academic_year_id, period_no, name_en, name_bn, starts_at, ends_at, is_break)
select md5('kiisc-sample:period:2026:' || p.no)::uuid, md5('kiisc-sample:year:2026')::uuid, p.no, p.name_en, p.name_bn, p.s::time, p.e::time, p.brk
from (values
  (1, 'Period 1', '১ম পিরিয়ড', '08:00', '08:40', false),
  (2, 'Period 2', '২য় পিরিয়ড', '08:40', '09:20', false),
  (3, 'Period 3', '৩য় পিরিয়ড', '09:20', '10:00', false),
  (4, 'Break', 'বিরতি', '10:00', '10:20', true),
  (5, 'Period 4', '৪র্থ পিরিয়ড', '10:20', '11:00', false),
  (6, 'Period 5', '৫ম পিরিয়ড', '11:00', '11:40', false),
  (7, 'Period 6', '৬ষ্ঠ পিরিয়ড', '11:40', '12:20', false)
) as p(no, name_en, name_bn, s, e, brk)
on conflict do nothing;

-- Saturday–Thursday; subjects rotate through the class curriculum.
insert into public.timetable_entries (id, section_id, academic_year_id, weekday, period_no, subject_id, teacher_id)
select md5('kiisc-sample:tt:' || d.wd || ':' || p.no)::uuid,
       md5('kiisc-sample:section:2026:class-6:bangla_medium:A')::uuid, md5('kiisc-sample:year:2026')::uuid,
       d.wd, p.no, subj.subject_id,
       case when subj.code = 'mathematics' then md5('kiisc-sample:teacher:t3')::uuid end
from (values (6), (7), (1), (2), (3), (4)) as d(wd)
cross join (values (1), (2), (3), (5), (6), (7)) as p(no)
cross join lateral (
  select cs.subject_id, s.code
  from public.class_subjects cs
  join public.subjects s on s.id = cs.subject_id
  where cs.class_id = md5('kiisc-sample:class:class-6')::uuid and cs.medium = 'bangla_medium'
  order by cs.sort_order, s.code
  offset ((d.wd + p.no) % greatest(1, (select count(*) from public.class_subjects
                                         where class_id = md5('kiisc-sample:class:class-6')::uuid and medium = 'bangla_medium')))
  limit 1
) subj
on conflict do nothing;

insert into public.learning_resources (id, academic_year_id, class_id, medium, title_en, title_bn, description, external_url)
values (md5('kiisc-sample:resource:nctb')::uuid, md5('kiisc-sample:year:2026')::uuid, md5('kiisc-sample:class:class-6')::uuid,
        'bangla_medium', '[Sample] NCTB textbooks (official site)', '[নমুনা] এনসিটিবি পাঠ্যবই (অফিসিয়াল সাইট)',
        'Free digital copies of national curriculum textbooks.', 'https://nctb.portal.gov.bd/')
on conflict do nothing;

-- ---------- Website content ----------
insert into public.notices (id, title_en, title_bn, body_en, body_bn, category, status, publish_at)
select md5('kiisc-sample:notice:' || n.key)::uuid, n.title_en, n.title_bn, n.body_en, n.body_bn, n.category::public.notice_category, 'published', now() - n.age
from (values
  ('admission-2027', '[Sample] Admission open for Academic Year 2027', '[নমুনা] শিক্ষাবর্ষ ২০২৭-এ ভর্তি চলছে',
   'This is a sample notice. Online applications are open for Play to Class 9 (Bangla Medium and English Version). Apply from the Admissions page.',
   'এটি একটি নমুনা নোটিশ। প্লে থেকে নবম শ্রেণি (বাংলা মাধ্যম ও ইংরেজি ভার্সন) পর্যন্ত অনলাইন আবেদন চলছে। ভর্তি পৃষ্ঠা থেকে আবেদন করুন।',
   'admission', interval '1 day'),
  ('annual-exam', '[Sample] Annual examination routine published', '[নমুনা] বার্ষিক পরীক্ষার রুটিন প্রকাশ',
   'This is a sample notice. The annual examination routine will be shared with students in class.',
   'এটি একটি নমুনা নোটিশ। বার্ষিক পরীক্ষার রুটিন শ্রেণিকক্ষে শিক্ষার্থীদের জানানো হবে।',
   'examination', interval '3 days'),
  ('victory-day', '[Sample] Holiday for Victory Day', '[নমুনা] বিজয় দিবসের ছুটি',
   'This is a sample notice. The institution will remain closed on 16 December.',
   'এটি একটি নমুনা নোটিশ। ১৬ ডিসেম্বর প্রতিষ্ঠান বন্ধ থাকবে।',
   'holiday', interval '5 days')
) as n(key, title_en, title_bn, body_en, body_bn, category, age)
on conflict do nothing;

insert into public.events (id, title_en, title_bn, description_en, description_bn, event_type, starts_on, ends_on, location, status)
select md5('kiisc-sample:event:' || e.key)::uuid, e.title_en, e.title_bn, e.desc_en, e.desc_bn, e.type::public.event_type,
       e.starts, e.ends, e.location, 'published'
from (values
  ('parents-meeting', '[Sample] Parents'' meeting', '[নমুনা] অভিভাবক সভা', 'Sample event for demonstration.', 'প্রদর্শনের জন্য নমুনা অনুষ্ঠান।', 'parent_meeting', date '2026-11-14', null::date, 'Main hall'),
  ('annual-sports', '[Sample] Annual sports day', '[নমুনা] বার্ষিক ক্রীড়া প্রতিযোগিতা', 'Sample event for demonstration.', 'প্রদর্শনের জন্য নমুনা অনুষ্ঠান।', 'sports', date '2026-12-05', null::date, 'School ground'),
  ('victory-day', '[Sample] Victory Day', '[নমুনা] বিজয় দিবস', 'Sample calendar entry.', 'নমুনা ক্যালেন্ডার তথ্য।', 'holiday', date '2026-12-16', null::date, null),
  ('annual-exam', '[Sample] Annual examination', '[নমুনা] বার্ষিক পরীক্ষা', 'Sample calendar entry.', 'নমুনা ক্যালেন্ডার তথ্য।', 'examination', date '2026-11-25', date '2026-12-08', null)
) as e(key, title_en, title_bn, desc_en, desc_bn, type, starts, ends, location)
on conflict do nothing;
