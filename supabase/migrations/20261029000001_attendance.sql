-- =====================================================================
-- Stage 5: teachers, teaching assignments, holidays, daily attendance,
-- correction workflow and attendance reports.
-- Teachers never read the students table directly: they get a minimal
-- roster (ID, name, roll) for sections they are assigned to.
-- =====================================================================

create type public.attendance_status as enum ('present', 'absent', 'late', 'leave');
create type public.assignment_role as enum ('class_teacher', 'subject_teacher');
create type public.correction_status as enum ('pending', 'approved', 'rejected');

-- The school's calendar date (Bangladesh time). The database runs in UTC, so
-- current_date would still be "yesterday" between 00:00 and 06:00 in Dhaka.
create or replace function public.school_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Dhaka')::date;
$$;

create or replace function public.can_view_attendance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin', 'principal']::public.app_role[]);
$$;

create or replace function public.can_manage_teaching()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]);
$$;

-- ---------- Teachers ---------------------------------------------------------
create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  staff_code text not null unique,
  user_id uuid unique references public.user_profiles (id) on delete set null,
  name_en text not null check (char_length(name_en) between 2 and 150),
  name_bn text check (char_length(name_bn) <= 150),
  designation_en text check (char_length(designation_en) <= 100),
  designation_bn text check (char_length(designation_bn) <= 100),
  phone text check (phone is null or phone ~ '^01[3-9][0-9]{8}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  joined_on date,
  is_active boolean not null default true,
  show_on_website boolean not null default false,   -- only with the teacher's consent
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.assign_staff_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.staff_code := 'KI-T-' || public.pad_number(public.next_document_number('teacher'), 3);
  return new;
end $$;
create trigger teachers_staff_code before insert on public.teachers
  for each row execute function public.assign_staff_code();

create or replace function public.guard_teacher_update()
returns trigger language plpgsql as $$
begin
  if new.staff_code <> old.staff_code then raise exception 'IMMUTABLE_FIELD'; end if;
  return new;
end $$;
create trigger teachers_guard before update on public.teachers
  for each row execute function public.guard_teacher_update();

create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id),
  section_id uuid not null references public.sections (id) on delete cascade,
  role public.assignment_role not null,
  subject_id uuid references public.subjects (id),
  created_at timestamptz not null default now(),
  constraint teacher_assignments_subject check ((role = 'subject_teacher') = (subject_id is not null))
);
create unique index teacher_assignments_one_class_teacher on public.teacher_assignments (section_id) where role = 'class_teacher';
create unique index teacher_assignments_one_per_subject on public.teacher_assignments (section_id, subject_id) where role = 'subject_teacher';
create index teacher_assignments_teacher_idx on public.teacher_assignments (teacher_id);

-- A subject can only be assigned if it is in that class/stream's curriculum.
create or replace function public.validate_teacher_assignment()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.teachers where id = new.teacher_id and is_active) then
    raise exception 'TEACHER_NOT_ACTIVE';
  end if;
  if new.subject_id is not null and not exists (
    select 1 from public.sections s
    join public.class_subjects cs on cs.class_id = s.class_id and cs.medium = s.medium
    where s.id = new.section_id and cs.subject_id = new.subject_id
  ) then
    raise exception 'SUBJECT_NOT_IN_CURRICULUM';
  end if;
  return new;
end $$;
create trigger teacher_assignments_validate before insert or update on public.teacher_assignments
  for each row execute function public.validate_teacher_assignment();

create or replace function public.my_teacher_id()
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from public.teachers t
  where t.user_id = auth.uid() and t.is_active and public.has_role('teacher');
$$;

create or replace function public.teaches_section(p_section uuid, p_class_teacher_only boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teacher_assignments ta
    where ta.section_id = p_section and ta.teacher_id = public.my_teacher_id()
      and (not p_class_teacher_only or ta.role = 'class_teacher')
  );
$$;

-- Safe public listing for the website's Faculty page (no phone/email).
create or replace function public.get_public_faculty()
returns table (id uuid, name_en text, name_bn text, designation_en text, designation_bn text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name_en, t.name_bn, t.designation_en, t.designation_bn
  from public.teachers t
  where t.show_on_website and t.is_active
  order by t.sort_order, t.name_en;
$$;

-- ---------- Calendar rules ------------------------------------------------------
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date,
  name_en text not null check (char_length(name_en) <= 120),
  name_bn text check (char_length(name_bn) <= 120),
  created_at timestamptz not null default now(),
  constraint holidays_dates check (ends_on is null or ends_on >= starts_on)
);
create index holidays_dates_idx on public.holidays (starts_on, ends_on);

create table public.attendance_settings (
  id boolean primary key default true check (id),
  weekly_off_days int[] not null default '{5}',   -- ISO weekday numbers; 5 = Friday
  teacher_edit_days int not null default 3 check (teacher_edit_days between 0 and 60),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint attendance_settings_days check (weekly_off_days <@ array[1, 2, 3, 4, 5, 6, 7])
);
insert into public.attendance_settings default values;
create trigger attendance_settings_stamp before update on public.attendance_settings
  for each row execute function public.stamp_updated_by();

create or replace function public.is_working_day(p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from p_date)::int <> all (coalesce((select weekly_off_days from public.attendance_settings), '{}'::int[]))
     and not exists (
       select 1 from public.holidays h where p_date between h.starts_on and coalesce(h.ends_on, h.starts_on)
     );
$$;

-- ---------- Attendance ----------------------------------------------------------
create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id),
  date date not null,
  recorded_by uuid references auth.users (id),
  recorded_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (section_id, date)                          -- one sheet per section per day
);

create table public.attendance_records (
  session_id uuid not null references public.attendance_sessions (id),
  student_id uuid not null references public.students (id),
  status public.attendance_status not null,
  note text check (char_length(note) <= 200),
  recorded_by uuid references auth.users (id),
  recorded_at timestamptz not null default now(),
  primary key (session_id, student_id)
);
create index attendance_records_student_idx on public.attendance_records (student_id);

create table public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions (id),
  student_id uuid not null,
  requested_status public.attendance_status not null,
  reason text not null check (char_length(reason) between 3 and 500),
  requested_by uuid references auth.users (id),
  requested_at timestamptz not null default now(),
  status public.correction_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500),
  foreign key (session_id, student_id) references public.attendance_records (session_id, student_id)
);
create unique index attendance_corrections_one_pending
  on public.attendance_correction_requests (session_id, student_id) where status = 'pending';

-- Students on a section's roster on a given date (enrollment covers the date).
create or replace function public._on_roster(p_student uuid, p_section uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.student_enrollments e
    where e.student_id = p_student and e.section_id = p_section
      and (e.start_date is null or e.start_date <= p_date)
      and (e.end_date is null or e.end_date >= p_date)
  );
$$;

-- Minimal roster for attendance: no addresses, guardians or notes.
create or replace function public.get_section_roster(p_section uuid, p_date date default public.school_today())
returns table (student_id uuid, student_code text, name_en text, name_bn text, roll_no int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.can_view_attendance() or public.can_view_students() or public.teaches_section(p_section)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select s.id, s.student_code, s.name_en, s.name_bn, e.roll_no
    from public.student_enrollments e
    join public.students s on s.id = e.student_id
    where e.section_id = p_section
      and (e.start_date is null or e.start_date <= p_date)
      and (e.end_date is null or e.end_date >= p_date)
    order by e.roll_no nulls last, s.name_en;
end $$;

-- Records (or re-records) one section's attendance for one day.
-- p_records: [{ "student_id", "status", "note"? }]
create or replace function public.save_attendance(p_section uuid, p_date date, p_records jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  sec public.sections;
  y public.academic_years;
  v_admin boolean := public.can_manage_teaching();
  v_edit_days int;
  v_session uuid;
begin
  select * into sec from public.sections where id = p_section;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (v_admin or public.teaches_section(p_section, true)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_date is null or p_date > public.school_today() then raise exception 'FUTURE_DATE'; end if;
  select * into y from public.academic_years where id = sec.academic_year_id;
  if p_date < y.starts_on or p_date > y.ends_on then raise exception 'OUTSIDE_ACADEMIC_YEAR'; end if;
  if not public.is_working_day(p_date) then raise exception 'NOT_A_WORKING_DAY'; end if;
  select teacher_edit_days into v_edit_days from public.attendance_settings;
  if not v_admin and p_date < public.school_today() - v_edit_days then raise exception 'EDIT_WINDOW_CLOSED'; end if;

  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then raise exception 'NO_RECORDS'; end if;
  if (select count(*) <> count(distinct x.student_id) from jsonb_to_recordset(p_records) as x(student_id uuid)) then
    raise exception 'DUPLICATE_STUDENT';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_records) as x(student_id uuid)
    where not public._on_roster(x.student_id, p_section, p_date)
  ) then
    raise exception 'STUDENT_NOT_IN_SECTION';
  end if;

  insert into public.attendance_sessions (section_id, date, recorded_by, updated_by)
  values (p_section, p_date, auth.uid(), auth.uid())
  on conflict (section_id, date) do update set updated_by = auth.uid(), updated_at = now()
  returning id into v_session;

  insert into public.attendance_records (session_id, student_id, status, note, recorded_by, recorded_at)
  select v_session, x.student_id, x.status, left(nullif(trim(x.note), ''), 200), auth.uid(), now()
  from jsonb_to_recordset(p_records) as x(student_id uuid, status public.attendance_status, note text)
  on conflict (session_id, student_id) do update
    set status = excluded.status, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
    where public.attendance_records.status is distinct from excluded.status
       or public.attendance_records.note is distinct from excluded.note;

  return v_session;
end $$;

create or replace function public.request_attendance_correction(
  p_session uuid, p_student uuid, p_status public.attendance_status, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_section uuid;
  v_current public.attendance_status;
  v_id uuid;
begin
  select section_id into v_section from public.attendance_sessions where id = p_session;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.can_manage_teaching() or public.teaches_section(v_section)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select status into v_current from public.attendance_records where session_id = p_session and student_id = p_student;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_current = p_status then raise exception 'NO_CHANGE'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if exists (
    select 1 from public.attendance_correction_requests
    where session_id = p_session and student_id = p_student and status = 'pending'
  ) then
    raise exception 'ALREADY_PENDING';
  end if;
  insert into public.attendance_correction_requests (session_id, student_id, requested_status, reason, requested_by)
  values (p_session, p_student, p_status, left(trim(p_reason), 500), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Approval by the principal or administrators; nobody reviews their own request.
create or replace function public.review_attendance_correction(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.attendance_correction_requests;
begin
  if not public.can_view_attendance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.attendance_correction_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
  if r.requested_by = auth.uid() then raise exception 'SELF_REVIEW'; end if;
  if p_approve then
    update public.attendance_records
    set status = r.requested_status, recorded_by = auth.uid(), recorded_at = now()
    where session_id = r.session_id and student_id = r.student_id;
  end if;
  update public.attendance_correction_requests
  set status = case when p_approve then 'approved' else 'rejected' end::public.correction_status,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(trim(p_note), ''), 500)
  where id = p_request;
end $$;

-- ---------- Reports -----------------------------------------------------------------
-- Per-student totals for one section over a date range.
create or replace function public.attendance_section_summary(p_section uuid, p_from date, p_to date)
returns table (
  student_id uuid, student_code text, name_en text, name_bn text, roll_no int,
  present int, absent int, late int, on_leave int, recorded_days int
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.can_view_attendance() or public.teaches_section(p_section)) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
    select s.id, s.student_code, s.name_en, s.name_bn, e.roll_no,
           count(*) filter (where r.status = 'present')::int,
           count(*) filter (where r.status = 'absent')::int,
           count(*) filter (where r.status = 'late')::int,
           count(*) filter (where r.status = 'leave')::int,
           count(r.status)::int
    from public.student_enrollments e
    join public.students s on s.id = e.student_id
    left join public.attendance_sessions a on a.section_id = e.section_id and a.date between p_from and p_to
    left join public.attendance_records r on r.session_id = a.id and r.student_id = s.id
    where e.section_id = p_section
      and (e.start_date is null or e.start_date <= p_to)
      and (e.end_date is null or e.end_date >= p_from)
    group by s.id, s.student_code, s.name_en, s.name_bn, e.roll_no
    order by e.roll_no nulls last, s.name_en;
end $$;

-- One row per section of the academic year containing p_date.
create or replace function public.attendance_overview(p_date date)
returns table (
  section_id uuid, section_name text, class_name_en text, class_name_bn text, class_level int,
  medium public.education_medium, on_roll int, recorded boolean,
  present int, absent int, late int, on_leave int
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_view_attendance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
    select se.id, se.name, c.name_en, c.name_bn, c.level, se.medium,
           (select count(*)::int from public.student_enrollments e
             where e.section_id = se.id and (e.start_date is null or e.start_date <= p_date)
               and (e.end_date is null or e.end_date >= p_date)),
           a.id is not null,
           coalesce((select count(*)::int from public.attendance_records r where r.session_id = a.id and r.status = 'present'), 0),
           coalesce((select count(*)::int from public.attendance_records r where r.session_id = a.id and r.status = 'absent'), 0),
           coalesce((select count(*)::int from public.attendance_records r where r.session_id = a.id and r.status = 'late'), 0),
           coalesce((select count(*)::int from public.attendance_records r where r.session_id = a.id and r.status = 'leave'), 0)
    from public.sections se
    join public.academic_years y on y.id = se.academic_year_id and p_date between y.starts_on and y.ends_on
    join public.classes c on c.id = se.class_id
    left join public.attendance_sessions a on a.section_id = se.id and a.date = p_date
    order by c.level, se.medium, se.name;
end $$;

-- Students with at least p_min_absences absences in a date range.
create or replace function public.attendance_absence_report(p_from date, p_to date, p_min_absences int default 1)
returns table (
  student_id uuid, student_code text, name_en text, name_bn text,
  class_name_en text, class_name_bn text, section_name text, absent int, recorded_days int
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_view_attendance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
    select s.id, s.student_code, s.name_en, s.name_bn, c.name_en, c.name_bn, se.name,
           count(*) filter (where r.status = 'absent')::int,
           count(*)::int
    from public.attendance_records r
    join public.attendance_sessions a on a.id = r.session_id and a.date between p_from and p_to
    join public.sections se on se.id = a.section_id
    join public.classes c on c.id = se.class_id
    join public.students s on s.id = r.student_id
    group by s.id, s.student_code, s.name_en, s.name_bn, c.name_en, c.name_bn, c.level, se.name
    having count(*) filter (where r.status = 'absent') >= greatest(p_min_absences, 1)
    order by count(*) filter (where r.status = 'absent') desc, c.level, s.name_en;
end $$;

-- ---------- Triggers ------------------------------------------------------------------
create trigger teachers_updated_at before update on public.teachers
  for each row execute function public.set_updated_at();
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'teachers', 'teacher_assignments', 'holidays', 'attendance_settings',
    'attendance_records', 'attendance_correction_requests'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', tbl || '_audit', tbl);
  end loop;
end $$;

-- ---------- Grants & RLS ----------------------------------------------------------------
revoke execute on function public._on_roster(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.save_attendance(uuid, date, jsonb) from public, anon;
revoke execute on function public.request_attendance_correction(uuid, uuid, public.attendance_status, text) from public, anon;
revoke execute on function public.review_attendance_correction(uuid, boolean, text) from public, anon;
revoke execute on function public.get_section_roster(uuid, date) from public, anon;
revoke execute on function public.attendance_section_summary(uuid, date, date) from public, anon;
revoke execute on function public.attendance_overview(date) from public, anon;
revoke execute on function public.attendance_absence_report(date, date, int) from public, anon;
grant execute on function public.save_attendance(uuid, date, jsonb) to authenticated;
grant execute on function public.request_attendance_correction(uuid, uuid, public.attendance_status, text) to authenticated;
grant execute on function public.review_attendance_correction(uuid, boolean, text) to authenticated;
grant execute on function public.get_section_roster(uuid, date) to authenticated;
grant execute on function public.attendance_section_summary(uuid, date, date) to authenticated;
grant execute on function public.attendance_overview(date) to authenticated;
grant execute on function public.attendance_absence_report(date, date, int) to authenticated;
grant execute on function public.get_public_faculty() to anon, authenticated;

alter table public.teachers enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.holidays enable row level security;
alter table public.attendance_settings enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_correction_requests enable row level security;

revoke all on public.teachers, public.teacher_assignments, public.attendance_sessions,
  public.attendance_records, public.attendance_correction_requests, public.attendance_settings from anon;

create policy "teachers: staff and teachers read" on public.teachers for select to authenticated
  using (public.has_any_role(array['super_admin', 'school_admin', 'principal', 'admission_officer', 'accounts_officer', 'teacher']::public.app_role[]));
create policy "teachers: managers insert" on public.teachers for insert to authenticated with check (public.can_manage_teaching());
create policy "teachers: managers update" on public.teachers for update to authenticated
  using (public.can_manage_teaching()) with check (public.can_manage_teaching());
revoke delete on public.teachers from authenticated;   -- deactivate instead (history)

create policy "assignments: staff or own" on public.teacher_assignments for select to authenticated
  using (public.can_view_attendance() or public.can_manage_teaching() or teacher_id = public.my_teacher_id());
create policy "assignments: managers insert" on public.teacher_assignments for insert to authenticated with check (public.can_manage_teaching());
create policy "assignments: managers update" on public.teacher_assignments for update to authenticated
  using (public.can_manage_teaching()) with check (public.can_manage_teaching());
create policy "assignments: managers delete" on public.teacher_assignments for delete to authenticated using (public.can_manage_teaching());

create policy "holidays: public read" on public.holidays for select to anon, authenticated using (true);
create policy "holidays: managers insert" on public.holidays for insert to authenticated with check (public.can_manage_teaching());
create policy "holidays: managers update" on public.holidays for update to authenticated
  using (public.can_manage_teaching()) with check (public.can_manage_teaching());
create policy "holidays: managers delete" on public.holidays for delete to authenticated using (public.can_manage_teaching());
revoke insert, update, delete on public.holidays from anon;

create policy "attendance settings: signed-in read" on public.attendance_settings for select to authenticated using (true);
create policy "attendance settings: managers update" on public.attendance_settings for update to authenticated
  using (public.can_manage_teaching()) with check (public.can_manage_teaching());
revoke insert, delete on public.attendance_settings from authenticated;

-- Helpers read across the two tables without RLS, so the policies below
-- do not recurse into each other.
create or replace function public._session_section(p_session uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select section_id from public.attendance_sessions where id = p_session;
$$;
create or replace function public._session_has_own_child(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.attendance_records r
    where r.session_id = p_session and (public.is_guardian_of(r.student_id) or public.is_student_self(r.student_id))
  );
$$;

create policy "sessions: staff, section teachers, own child" on public.attendance_sessions for select to authenticated
  using (public.can_view_attendance() or public.teaches_section(section_id) or public._session_has_own_child(id));
create policy "records: staff, section teachers, own child" on public.attendance_records for select to authenticated
  using (
    public.can_view_attendance()
    or public.is_guardian_of(student_id) or public.is_student_self(student_id)
    or public.teaches_section(public._session_section(session_id))
  );
create policy "corrections: reviewers or requester" on public.attendance_correction_requests for select to authenticated
  using (public.can_view_attendance() or requested_by = auth.uid());

-- All attendance writes go through the functions above.
revoke insert, update, delete on public.attendance_sessions, public.attendance_records, public.attendance_correction_requests from authenticated;
