-- =====================================================================
-- Stage 6: grading schemes, examinations, marks entry, review/approval/
-- publication workflow, marks corrections, server-side result calculation.
-- Students and guardians only ever see PUBLISHED results for themselves.
-- =====================================================================

create type public.exam_status as enum ('draft', 'marks_entry', 'under_review', 'approved', 'published');
create type public.mark_status as enum ('present', 'absent', 'exempt');
create type public.absent_policy as enum ('count_as_zero', 'mark_incomplete');
create type public.overall_method as enum ('gpa', 'percentage');

create or replace function public.can_manage_exams()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]);
$$;

create or replace function public.can_approve_results()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'principal']::public.app_role[]);
$$;

-- ---------- Grading ----------------------------------------------------------
create table public.grading_schemes (
  id uuid primary key default gen_random_uuid(),
  name_en text not null check (char_length(name_en) between 2 and 100),
  name_bn text check (char_length(name_bn) <= 100),
  overall_method public.overall_method not null default 'gpa',
  fail_in_any_subject_fails boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grade_rules (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references public.grading_schemes (id) on delete cascade,
  grade text not null check (char_length(grade) between 1 and 10),
  min_percent numeric(5, 2) not null check (min_percent between 0 and 100),
  max_percent numeric(5, 2) not null check (max_percent between 0 and 100),
  grade_point numeric(3, 2) check (grade_point is null or grade_point between 0 and 5),
  is_fail boolean not null default false,
  remark_en text check (char_length(remark_en) <= 50),
  remark_bn text check (char_length(remark_bn) <= 50),
  constraint grade_rules_range check (min_percent <= max_percent),
  unique (scheme_id, grade)
);

create or replace function public.validate_grade_rule()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.grade_rules r
    where r.scheme_id = new.scheme_id and r.id <> new.id
      and numrange(r.min_percent, r.max_percent, '[]') && numrange(new.min_percent, new.max_percent, '[]')
  ) then
    raise exception 'OVERLAPPING_RANGES';
  end if;
  return new;
end $$;
create trigger grade_rules_validate before insert or update on public.grade_rules
  for each row execute function public.validate_grade_rule();

-- ---------- Examinations -------------------------------------------------------
create table public.examinations (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id),
  term_id uuid references public.academic_terms (id),
  name_en text not null check (char_length(name_en) between 2 and 120),
  name_bn text check (char_length(name_bn) <= 120),
  grading_scheme_id uuid not null references public.grading_schemes (id),
  absent_policy public.absent_policy not null default 'count_as_zero',
  starts_on date,
  ends_on date,
  status public.exam_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint examinations_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index examinations_year_idx on public.examinations (academic_year_id, status);

create table public.examination_subjects (
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null references public.examinations (id) on delete cascade,
  class_id uuid not null references public.classes (id),
  medium public.education_medium not null,
  subject_id uuid not null references public.subjects (id),
  full_marks numeric(6, 2) not null check (full_marks > 0 and full_marks <= 1000),
  pass_marks numeric(6, 2) not null check (pass_marks >= 0),
  exam_date date,
  include_in_total boolean not null default true,
  sort_order int not null default 0,
  constraint examination_subjects_pass check (pass_marks <= full_marks),
  foreign key (class_id, medium, subject_id) references public.class_subjects (class_id, medium, subject_id),
  unique (examination_id, class_id, medium, subject_id)
);

create table public.student_marks (
  id uuid primary key default gen_random_uuid(),
  examination_subject_id uuid not null references public.examination_subjects (id),
  student_id uuid not null references public.students (id),
  section_id uuid not null references public.sections (id),
  marks numeric(6, 2) check (marks is null or marks >= 0),
  mark_status public.mark_status not null default 'present',
  entered_by uuid references auth.users (id),
  entered_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint student_marks_status check (mark_status = 'present' or marks is null),
  unique (examination_subject_id, student_id)
);
create index student_marks_section_idx on public.student_marks (section_id);
create index student_marks_student_idx on public.student_marks (student_id);

create table public.exam_status_history (
  id bigint generated always as identity primary key,
  examination_id uuid not null references public.examinations (id) on delete cascade,
  from_status public.exam_status,
  to_status public.exam_status not null,
  note text check (char_length(note) <= 500),
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);

create table public.result_publications (
  id bigint generated always as identity primary key,
  examination_id uuid not null references public.examinations (id),
  action text not null check (action in ('published', 'unpublished')),
  note text check (char_length(note) <= 500),
  acted_by uuid references auth.users (id),
  acted_at timestamptz not null default now()
);

create table public.marks_correction_requests (
  id uuid primary key default gen_random_uuid(),
  mark_id uuid not null references public.student_marks (id),
  requested_marks numeric(6, 2),
  requested_status public.mark_status not null,
  reason text not null check (char_length(reason) between 3 and 500),
  requested_by uuid references auth.users (id),
  requested_at timestamptz not null default now(),
  status public.correction_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500),
  constraint marks_correction_status check (requested_status = 'present' or requested_marks is null)
);
create unique index marks_corrections_one_pending on public.marks_correction_requests (mark_id) where status = 'pending';

-- ---------- Guards --------------------------------------------------------------
create or replace function public._exam_status(p_exam uuid)
returns public.exam_status language sql stable security definer set search_path = public as $$
  select status from public.examinations where id = p_exam;
$$;

create or replace function public.guard_examination()
returns trigger language plpgsql as $$
begin
  if new.status <> old.status and coalesce(current_setting('app.status_change', true), '') <> 'on' then
    raise exception 'USE_STATUS_FUNCTION';
  end if;
  if old.status in ('approved', 'published')
     and (new.grading_scheme_id <> old.grading_scheme_id or new.absent_policy <> old.absent_policy
          or new.academic_year_id <> old.academic_year_id) then
    raise exception 'EXAM_LOCKED';
  end if;
  return new;
end $$;
create trigger examinations_guard before update on public.examinations
  for each row execute function public.guard_examination();

-- Subject configuration can change only while the exam is in draft or marks entry,
-- and full marks can never drop below marks already entered.
create or replace function public.guard_examination_subject()
returns trigger language plpgsql as $$
declare v_exam uuid := coalesce(new.examination_id, old.examination_id);
begin
  if public._exam_status(v_exam) not in ('draft', 'marks_entry')
     and coalesce(current_setting('app.status_change', true), '') <> 'on' then
    raise exception 'EXAM_LOCKED';
  end if;
  if tg_op = 'UPDATE' and new.full_marks < old.full_marks and exists (
    select 1 from public.student_marks m where m.examination_subject_id = new.id and m.marks > new.full_marks
  ) then
    raise exception 'MARKS_EXCEED_FULL';
  end if;
  return coalesce(new, old);
end $$;
create trigger examination_subjects_guard before insert or update or delete on public.examination_subjects
  for each row execute function public.guard_examination_subject();

-- ---------- Workflow -----------------------------------------------------------
create or replace function public.set_exam_status(p_exam uuid, p_status public.exam_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_from public.exam_status;
  v_manage boolean := public.can_manage_exams();
  v_approve boolean := public.can_approve_results();
  v_ok boolean;
begin
  select status into v_from from public.examinations where id = p_exam for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  v_ok := case
    when v_from = 'draft' and p_status = 'marks_entry' then v_manage
    when v_from = 'marks_entry' and p_status in ('draft', 'under_review') then v_manage
    when v_from = 'under_review' and p_status = 'marks_entry' then v_manage or v_approve
    when v_from = 'under_review' and p_status = 'approved' then v_approve
    when v_from = 'approved' and p_status in ('under_review', 'published') then v_approve
    when v_from = 'published' and p_status = 'approved' then v_approve
    else null
  end;
  if v_ok is null then raise exception 'INVALID_TRANSITION'; end if;
  if not v_ok then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_status = 'marks_entry' and not exists (select 1 from public.examination_subjects where examination_id = p_exam) then
    raise exception 'NO_SUBJECTS';
  end if;

  perform set_config('app.status_change', 'on', true);
  update public.examinations set status = p_status where id = p_exam;
  perform set_config('app.status_change', '', true);

  insert into public.exam_status_history (examination_id, from_status, to_status, note, changed_by)
  values (p_exam, v_from, p_status, left(nullif(trim(p_note), ''), 500), auth.uid());
  if p_status = 'published' or v_from = 'published' then
    insert into public.result_publications (examination_id, action, note, acted_by)
    values (p_exam, case when p_status = 'published' then 'published' else 'unpublished' end, left(nullif(trim(p_note), ''), 500), auth.uid());
  end if;
end $$;

-- Teacher of this subject in this section?
create or replace function public.teaches_subject(p_section uuid, p_subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teacher_assignments ta
    where ta.section_id = p_section and ta.teacher_id = public.my_teacher_id()
      and ta.role = 'subject_teacher' and ta.subject_id = p_subject
  );
$$;

-- p_entries: [{ "student_id", "marks"?, "mark_status"? }]
create or replace function public.save_marks(p_exam_subject uuid, p_section uuid, p_entries jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  es public.examination_subjects;
  ex public.examinations;
  sec public.sections;
  v_manage boolean := public.can_manage_exams();
  n int;
begin
  select * into es from public.examination_subjects where id = p_exam_subject;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into ex from public.examinations where id = es.examination_id;
  select * into sec from public.sections where id = p_section;
  if sec.id is null or sec.academic_year_id <> ex.academic_year_id or sec.class_id <> es.class_id or sec.medium <> es.medium then
    raise exception 'SECTION_MISMATCH';
  end if;
  if not (v_manage or public.teaches_subject(p_section, es.subject_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if not ((ex.status = 'marks_entry') or (v_manage and ex.status in ('draft', 'under_review'))) then
    raise exception 'EXAM_NOT_OPEN';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'INVALID_INPUT'; end if;

  create temporary table _entries on commit drop as
    select x.student_id, x.marks, coalesce(x.mark_status, 'present') as mark_status
    from jsonb_to_recordset(p_entries) as x(student_id uuid, marks numeric, mark_status public.mark_status);

  if (select count(*) <> count(distinct student_id) from _entries) then raise exception 'DUPLICATE_STUDENT'; end if;
  if exists (
    select 1 from _entries e
    where not exists (select 1 from public.student_enrollments en where en.student_id = e.student_id and en.section_id = p_section)
  ) then
    raise exception 'STUDENT_NOT_IN_SECTION';
  end if;
  if exists (
    select 1 from _entries e
    where (e.mark_status = 'present' and e.marks is not null
           and (e.marks < 0 or e.marks > es.full_marks or e.marks <> round(e.marks, 2)))
       or (e.mark_status <> 'present' and e.marks is not null)
  ) then
    raise exception 'INVALID_MARKS';
  end if;

  insert into public.student_marks (examination_subject_id, student_id, section_id, marks, mark_status, entered_by, updated_by)
  select p_exam_subject, e.student_id, p_section, e.marks, e.mark_status, auth.uid(), auth.uid() from _entries e
  on conflict (examination_subject_id, student_id) do update
    set marks = excluded.marks, mark_status = excluded.mark_status, section_id = excluded.section_id,
        updated_by = auth.uid(), updated_at = now()
    where public.student_marks.marks is distinct from excluded.marks
       or public.student_marks.mark_status is distinct from excluded.mark_status;
  get diagnostics n = row_count;
  drop table _entries;
  return n;
end $$;

create or replace function public.request_marks_correction(
  p_mark uuid, p_marks numeric, p_status public.mark_status, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  m public.student_marks;
  es public.examination_subjects;
  v_id uuid;
begin
  select * into m from public.student_marks where id = p_mark;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into es from public.examination_subjects where id = m.examination_subject_id;
  if not (public.can_manage_exams() or public.teaches_subject(m.section_id, es.subject_id)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if public._exam_status(es.examination_id) not in ('under_review', 'approved', 'published') then
    raise exception 'USE_MARKS_ENTRY';
  end if;
  if (p_status = 'present' and (p_marks is null or p_marks < 0 or p_marks > es.full_marks or p_marks <> round(p_marks, 2)))
     or (p_status <> 'present' and p_marks is not null) then
    raise exception 'INVALID_MARKS';
  end if;
  if m.mark_status = p_status and m.marks is not distinct from p_marks then raise exception 'NO_CHANGE'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if exists (select 1 from public.marks_correction_requests where mark_id = p_mark and status = 'pending') then
    raise exception 'ALREADY_PENDING';
  end if;
  insert into public.marks_correction_requests (mark_id, requested_marks, requested_status, reason, requested_by)
  values (p_mark, p_marks, p_status, left(trim(p_reason), 500), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_marks_correction(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.marks_correction_requests;
begin
  if not public.can_approve_results() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.marks_correction_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
  if r.requested_by = auth.uid() then raise exception 'SELF_REVIEW'; end if;
  if p_approve then
    update public.student_marks
    set marks = r.requested_marks, mark_status = r.requested_status, updated_by = auth.uid(), updated_at = now()
    where id = r.mark_id;
  end if;
  update public.marks_correction_requests
  set status = case when p_approve then 'approved' else 'rejected' end::public.correction_status,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(trim(p_note), ''), 500)
  where id = p_request;
end $$;

-- ---------- Result calculation (server-side only) -------------------------------------
-- One row per student x exam subject for a section, with grade and pass/fail.
create or replace function public._exam_subject_outcomes(p_exam uuid, p_section uuid)
returns table (
  student_id uuid, examination_subject_id uuid, subject_id uuid, sort_order int,
  full_marks numeric, pass_marks numeric, marks numeric, mark_status public.mark_status,
  counted boolean, incomplete boolean, failed boolean, percent numeric, grade text, grade_point numeric
) language sql stable security definer set search_path = public as $$
  with ex as (
    select e.id, e.absent_policy, e.grading_scheme_id, se.class_id, se.medium
    from public.examinations e
    join public.sections se on se.id = p_section and se.academic_year_id = e.academic_year_id
    where e.id = p_exam
  ),
  subs as (
    select es.* from public.examination_subjects es
    join ex on es.examination_id = ex.id and es.class_id = ex.class_id and es.medium = ex.medium
  ),
  roster as (select distinct en.student_id from public.student_enrollments en where en.section_id = p_section),
  base as (
    select r.student_id, s.id as es_id, s.subject_id, s.sort_order, s.full_marks, s.pass_marks, s.include_in_total,
           m.marks, m.mark_status, ex.absent_policy, ex.grading_scheme_id
    from roster r
    cross join subs s
    cross join ex
    left join public.student_marks m on m.examination_subject_id = s.id and m.student_id = r.student_id
  ),
  calc as (
    select b.*,
      (b.mark_status is null or (b.mark_status = 'present' and b.marks is null)
        or (b.mark_status = 'absent' and b.absent_policy = 'mark_incomplete')) as is_incomplete,
      case when b.mark_status = 'present' then b.marks
           when b.mark_status = 'absent' and b.absent_policy = 'count_as_zero' then 0 end as eff
    from base b
  )
  select c.student_id, c.es_id, c.subject_id, c.sort_order, c.full_marks, c.pass_marks, c.eff, c.mark_status,
         (c.include_in_total and coalesce(c.mark_status, 'present') <> 'exempt' and not c.is_incomplete),
         c.is_incomplete,
         (not c.is_incomplete and coalesce(c.mark_status, 'present') <> 'exempt'
           and (c.eff < c.pass_marks or coalesce(g.is_fail, false))),
         round(c.eff / c.full_marks * 100, 2),
         g.grade, g.grade_point
  from calc c
  left join lateral (
    select gr.grade, gr.grade_point, gr.is_fail from public.grade_rules gr
    where gr.scheme_id = c.grading_scheme_id
      and round(c.eff / c.full_marks * 100, 2) between gr.min_percent and gr.max_percent
    order by gr.min_percent desc limit 1
  ) g on c.eff is not null and coalesce(c.mark_status, 'present') <> 'exempt';
$$;

-- Totals, GPA, overall grade, pass/fail and merit position per student.
create or replace function public._exam_results(p_exam uuid, p_section uuid)
returns table (
  student_id uuid, total_obtained numeric, total_full numeric, percentage numeric, gpa numeric,
  grade text, passed boolean, incomplete boolean, failed_subjects int, merit_position int
) language sql stable security definer set search_path = public as $$
  with o as (select * from public._exam_subject_outcomes(p_exam, p_section)),
  sch as (
    select gs.* from public.grading_schemes gs
    join public.examinations e on e.grading_scheme_id = gs.id where e.id = p_exam
  ),
  agg as (
    select o.student_id,
           coalesce(sum(o.marks) filter (where o.counted), 0) as tot,
           coalesce(sum(o.full_marks) filter (where o.counted), 0) as full_total,
           bool_or(o.incomplete) as inc,
           (count(*) filter (where o.failed))::int as nfail,
           avg(o.grade_point) filter (where o.counted) as avg_gp,
           coalesce(bool_and(o.grade_point is not null) filter (where o.counted), false) as has_gp
    from o group by o.student_id
  ),
  res as (
    select a.student_id, a.tot, a.full_total, a.inc, a.nfail,
           case when a.full_total > 0 then round(a.tot / a.full_total * 100, 2) end as pct,
           case when a.inc or not a.has_gp then null
                when a.nfail > 0 and (select fail_in_any_subject_fails from sch) then 0.00
                else round(a.avg_gp, 2) end as gpa
    from agg a
  )
  select r.student_id, r.tot, r.full_total, r.pct, r.gpa,
         case when r.inc then null
              when (select overall_method from sch) = 'gpa' and r.gpa is not null then (
                select gr.grade from public.grade_rules gr
                where gr.scheme_id = (select id from sch) and gr.grade_point is not null and gr.grade_point <= r.gpa
                order by gr.grade_point desc limit 1)
              else (
                select gr.grade from public.grade_rules gr
                where gr.scheme_id = (select id from sch) and r.pct between gr.min_percent and gr.max_percent
                order by gr.min_percent desc limit 1)
         end,
         (not r.inc and r.nfail = 0),
         r.inc, r.nfail,
         case when not r.inc then (rank() over (partition by r.inc order by (r.nfail = 0) desc, r.tot desc))::int end
  from res r;
$$;

create or replace function public.exam_section_results(p_exam uuid, p_section uuid)
returns table (
  student_id uuid, student_code text, name_en text, name_bn text, roll_no int,
  total_obtained numeric, total_full numeric, percentage numeric, gpa numeric, grade text,
  passed boolean, incomplete boolean, failed_subjects int, merit_position int
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.can_manage_exams() or public.can_approve_results() or public.teaches_section(p_section)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select r.student_id, s.student_code, s.name_en, s.name_bn,
           (select en.roll_no from public.student_enrollments en where en.student_id = s.id and en.section_id = p_section limit 1),
           r.total_obtained, r.total_full, r.percentage, r.gpa, r.grade, r.passed, r.incomplete, r.failed_subjects, r.merit_position
    from public._exam_results(p_exam, p_section) r
    join public.students s on s.id = r.student_id
    order by r.merit_position nulls last, s.name_en;
end $$;

-- Printable report card. Guardians and students: only after publication.
create or replace function public.exam_report_card(p_exam uuid, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ex public.examinations;
  v_section uuid;
begin
  select * into ex from public.examinations where id = p_exam;
  if not found then raise exception 'NOT_FOUND'; end if;
  select en.section_id into v_section from public.student_enrollments en
  where en.student_id = p_student and en.academic_year_id = ex.academic_year_id and en.section_id is not null
  order by en.created_at desc limit 1;
  if v_section is null then raise exception 'NOT_ENROLLED'; end if;
  if not (
    public.can_manage_exams() or public.can_approve_results() or public.teaches_section(v_section)
    or (ex.status = 'published' and (public.is_guardian_of(p_student) or public.is_student_self(p_student)))
  ) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'examination', jsonb_build_object('id', ex.id, 'name_en', ex.name_en, 'name_bn', ex.name_bn, 'status', ex.status,
      'year_en', (select name_en from public.academic_years where id = ex.academic_year_id),
      'year_bn', (select name_bn from public.academic_years where id = ex.academic_year_id)),
    'student', (select jsonb_build_object('id', s.id, 'student_code', s.student_code, 'name_en', s.name_en, 'name_bn', s.name_bn, 'medium', s.medium)
                from public.students s where s.id = p_student),
    'section', (select jsonb_build_object('name', se.name, 'class_name_en', c.name_en, 'class_name_bn', c.name_bn,
                  'roll_no', (select en.roll_no from public.student_enrollments en where en.student_id = p_student and en.section_id = se.id limit 1))
                from public.sections se join public.classes c on c.id = se.class_id where se.id = v_section),
    'subjects', (select coalesce(jsonb_agg(jsonb_build_object(
                    'name_en', sj.name_en, 'name_bn', sj.name_bn, 'full_marks', o.full_marks, 'pass_marks', o.pass_marks,
                    'marks', o.marks, 'mark_status', o.mark_status, 'grade', o.grade, 'grade_point', o.grade_point,
                    'failed', o.failed, 'incomplete', o.incomplete) order by o.sort_order, sj.name_en), '[]'::jsonb)
                 from public._exam_subject_outcomes(p_exam, v_section) o
                 join public.subjects sj on sj.id = o.subject_id
                 where o.student_id = p_student),
    'result', (select to_jsonb(r) - 'student_id' from public._exam_results(p_exam, v_section) r where r.student_id = p_student)
  );
end $$;

-- ---------- Triggers -------------------------------------------------------------------
create trigger grading_schemes_updated_at before update on public.grading_schemes for each row execute function public.set_updated_at();
create trigger examinations_updated_at before update on public.examinations for each row execute function public.set_updated_at();
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'grading_schemes', 'grade_rules', 'examinations', 'examination_subjects', 'student_marks', 'marks_correction_requests'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', tbl || '_audit', tbl);
  end loop;
end $$;

-- ---------- Grants & RLS ------------------------------------------------------------------
revoke execute on function public._exam_subject_outcomes(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._exam_results(uuid, uuid) from public, anon, authenticated;
-- Used inside RLS policies and triggers (evaluated as the caller); returns only a status.
revoke execute on function public._exam_status(uuid) from public, anon;
grant execute on function public._exam_status(uuid) to authenticated;
revoke execute on function public.set_exam_status(uuid, public.exam_status, text) from public, anon;
revoke execute on function public.save_marks(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.request_marks_correction(uuid, numeric, public.mark_status, text) from public, anon;
revoke execute on function public.review_marks_correction(uuid, boolean, text) from public, anon;
revoke execute on function public.exam_section_results(uuid, uuid) from public, anon;
revoke execute on function public.exam_report_card(uuid, uuid) from public, anon;
grant execute on function public.set_exam_status(uuid, public.exam_status, text) to authenticated;
grant execute on function public.save_marks(uuid, uuid, jsonb) to authenticated;
grant execute on function public.request_marks_correction(uuid, numeric, public.mark_status, text) to authenticated;
grant execute on function public.review_marks_correction(uuid, boolean, text) to authenticated;
grant execute on function public.exam_section_results(uuid, uuid) to authenticated;
grant execute on function public.exam_report_card(uuid, uuid) to authenticated;

alter table public.grading_schemes enable row level security;
alter table public.grade_rules enable row level security;
alter table public.examinations enable row level security;
alter table public.examination_subjects enable row level security;
alter table public.student_marks enable row level security;
alter table public.exam_status_history enable row level security;
alter table public.result_publications enable row level security;
alter table public.marks_correction_requests enable row level security;

revoke all on public.grading_schemes, public.grade_rules, public.examinations, public.examination_subjects,
  public.student_marks, public.exam_status_history, public.result_publications, public.marks_correction_requests from anon;

create policy "grading: signed-in read" on public.grading_schemes for select to authenticated using (true);
create policy "grading: managers write" on public.grading_schemes for all to authenticated
  using (public.can_manage_exams()) with check (public.can_manage_exams());
create policy "grade rules: signed-in read" on public.grade_rules for select to authenticated using (true);
create policy "grade rules: managers write" on public.grade_rules for all to authenticated
  using (public.can_manage_exams()) with check (public.can_manage_exams());

create or replace function public._exam_visible(p_status public.exam_status)
returns boolean language sql stable security definer set search_path = public as $$
  select p_status = 'published' or public.can_manage_exams() or public.can_approve_results() or public.has_role('teacher');
$$;

create policy "exams: staff, teachers, or published" on public.examinations for select to authenticated
  using (public._exam_visible(status));
create policy "exams: managers insert" on public.examinations for insert to authenticated
  with check (public.can_manage_exams() and status = 'draft');
create policy "exams: managers update" on public.examinations for update to authenticated
  using (public.can_manage_exams()) with check (public.can_manage_exams());
create policy "exams: managers delete drafts" on public.examinations for delete to authenticated
  using (public.can_manage_exams() and status = 'draft');

create policy "exam subjects: as exam" on public.examination_subjects for select to authenticated
  using (public._exam_visible(public._exam_status(examination_id)));
create policy "exam subjects: managers insert" on public.examination_subjects for insert to authenticated with check (public.can_manage_exams());
create policy "exam subjects: managers update" on public.examination_subjects for update to authenticated
  using (public.can_manage_exams()) with check (public.can_manage_exams());
create policy "exam subjects: managers delete" on public.examination_subjects for delete to authenticated using (public.can_manage_exams());

create or replace function public._mark_exam_status(p_exam_subject uuid)
returns public.exam_status language sql stable security definer set search_path = public as $$
  select e.status from public.examination_subjects es join public.examinations e on e.id = es.examination_id where es.id = p_exam_subject;
$$;

create policy "marks: staff, section teachers, own published" on public.student_marks for select to authenticated
  using (
    public.can_manage_exams() or public.can_approve_results() or public.teaches_section(section_id)
    or ((public.is_student_self(student_id) or public.is_guardian_of(student_id))
        and public._mark_exam_status(examination_subject_id) = 'published')
  );
revoke insert, update, delete on public.student_marks from authenticated;

create policy "exam history: staff read" on public.exam_status_history for select to authenticated
  using (public.can_manage_exams() or public.can_approve_results());
create policy "publications: staff read" on public.result_publications for select to authenticated
  using (public.can_manage_exams() or public.can_approve_results());
create policy "marks corrections: reviewers or requester" on public.marks_correction_requests for select to authenticated
  using (public.can_manage_exams() or public.can_approve_results() or requested_by = auth.uid());
revoke insert, update, delete on public.exam_status_history, public.result_publications, public.marks_correction_requests from authenticated;
