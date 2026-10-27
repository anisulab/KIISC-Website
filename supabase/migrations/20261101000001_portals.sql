-- =====================================================================
-- Stage 8: timetables, learning resources, guardian link requests, and
-- the access rules the student/parent portals rely on. Portal users only
-- ever see their own (or their verified children's) data.
-- =====================================================================

-- A signed-in student, or the verified guardian of one, currently in this section?
create or replace function public.has_section_member(p_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.student_enrollments e
    where e.section_id = p_section and e.status = 'enrolled'
      and (public.is_student_self(e.student_id) or public.is_guardian_of(e.student_id))
  );
$$;

-- ---------- Timetables ----------------------------------------------------------
create table public.timetable_periods (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  period_no int not null check (period_no between 1 and 20),
  name_en text check (char_length(name_en) <= 40),
  name_bn text check (char_length(name_bn) <= 40),
  starts_at time not null,
  ends_at time not null,
  is_break boolean not null default false,
  constraint timetable_periods_times check (ends_at > starts_at),
  unique (academic_year_id, period_no)
);

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id),
  weekday int not null check (weekday between 1 and 7),       -- ISO: 1 = Monday … 7 = Sunday
  period_no int not null,
  subject_id uuid not null references public.subjects (id),
  teacher_id uuid references public.teachers (id),
  room text check (char_length(room) <= 30),
  unique (section_id, weekday, period_no)
);
-- A teacher cannot be in two classes at the same time.
create unique index timetable_entries_teacher_clash
  on public.timetable_entries (academic_year_id, teacher_id, weekday, period_no) where teacher_id is not null;

create or replace function public.validate_timetable_entry()
returns trigger language plpgsql as $$
declare sec public.sections;
begin
  select * into sec from public.sections where id = new.section_id;
  new.academic_year_id := sec.academic_year_id;
  if not exists (
    select 1 from public.timetable_periods p
    where p.academic_year_id = sec.academic_year_id and p.period_no = new.period_no and not p.is_break
  ) then
    raise exception 'INVALID_PERIOD';
  end if;
  if not exists (
    select 1 from public.class_subjects cs
    where cs.class_id = sec.class_id and cs.medium = sec.medium and cs.subject_id = new.subject_id
  ) then
    raise exception 'SUBJECT_NOT_IN_CURRICULUM';
  end if;
  if new.teacher_id is not null and not exists (select 1 from public.teachers where id = new.teacher_id and is_active) then
    raise exception 'TEACHER_NOT_ACTIVE';
  end if;
  return new;
end $$;
create trigger timetable_entries_validate before insert or update on public.timetable_entries
  for each row execute function public.validate_timetable_entry();

-- ---------- Learning resources -----------------------------------------------------
create table public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id),
  class_id uuid not null references public.classes (id),
  medium public.education_medium not null,
  section_id uuid references public.sections (id) on delete cascade,   -- NULL = whole class/stream
  subject_id uuid references public.subjects (id),
  title_en text not null check (char_length(title_en) between 2 and 150),
  title_bn text check (char_length(title_bn) <= 150),
  description text check (char_length(description) <= 1000),
  file_path text unique,
  file_name text check (char_length(file_name) <= 200),
  mime_type text check (mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes int check (size_bytes is null or (size_bytes > 0 and size_bytes <= 10485760)),
  external_url text check (external_url is null or external_url ~ '^https://[^\s]+$'),
  is_published boolean not null default true,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint learning_resources_content check (file_path is not null or external_url is not null),
  foreign key (class_id, medium) references public.class_streams (class_id, medium)
);
create index learning_resources_class_idx on public.learning_resources (academic_year_id, class_id, medium);

create or replace function public.validate_learning_resource()
returns trigger language plpgsql as $$
begin
  new.uploaded_by := auth.uid();
  new.created_at := now();
  if new.section_id is not null and not exists (
    select 1 from public.sections s
    where s.id = new.section_id and s.academic_year_id = new.academic_year_id
      and s.class_id = new.class_id and s.medium = new.medium
  ) then
    raise exception 'SECTION_MISMATCH';
  end if;
  return new;
end $$;
create trigger learning_resources_validate before insert on public.learning_resources
  for each row execute function public.validate_learning_resource();

create or replace function public.can_access_resource(p_year uuid, p_class uuid, p_medium public.education_medium, p_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.student_enrollments e
    where e.academic_year_id = p_year and e.class_id = p_class and e.medium = p_medium and e.status = 'enrolled'
      and (p_section is null or e.section_id = p_section)
      and (public.is_student_self(e.student_id) or public.is_guardian_of(e.student_id))
  );
$$;

-- Teachers upload into "<section id>/…" for sections they teach.
create or replace function public._teaches_folder(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  begin
    v := ((storage.foldername(p_name))[1])::uuid;
  exception when others then
    return false;
  end;
  return public.teaches_section(v);
end $$;

-- ---------- Guardian link requests ---------------------------------------------------
-- A signed-in parent asks to be connected to a child. Staff approve only when the
-- phone number matches a guardian already on the student's record.
create table public.guardian_link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  student_code text not null check (char_length(student_code) between 3 and 20),
  guardian_phone text not null check (guardian_phone ~ '^01[3-9][0-9]{8}$'),
  relationship text not null check (char_length(relationship) between 2 and 50),
  note text check (char_length(note) <= 300),
  status public.correction_status not null default 'pending',
  student_id uuid references public.students (id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 300)
);
create unique index guardian_link_requests_one_pending
  on public.guardian_link_requests (user_id, upper(student_code)) where status = 'pending';

create or replace function public.stamp_link_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.status := 'pending';
  new.student_id := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.created_at := now();
  new.student_code := upper(trim(new.student_code));
  new.guardian_phone := coalesce(public.normalize_bd_phone(new.guardian_phone), new.guardian_phone);
  if (select count(*) from public.guardian_link_requests where user_id = auth.uid() and status = 'pending') >= 5 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  return new;
end $$;
create trigger guardian_link_requests_stamp before insert on public.guardian_link_requests
  for each row execute function public.stamp_link_request();

create or replace function public.review_guardian_link_request(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.guardian_link_requests;
  v_student uuid;
  v_guardian public.guardians;
  v_own uuid;
begin
  if not public.can_manage_students() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.guardian_link_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'NOT_PENDING'; end if;

  if p_approve then
    select id into v_student from public.students where upper(student_code) = r.student_code;
    if v_student is null then raise exception 'STUDENT_NOT_FOUND'; end if;
    -- Verification: the phone must belong to a guardian already linked to this student by staff.
    select g.* into v_guardian from public.guardians g
    join public.student_guardians sg on sg.guardian_id = g.id
    where sg.student_id = v_student and g.phone = r.guardian_phone
    limit 1;
    if v_guardian.id is null then raise exception 'PHONE_MISMATCH'; end if;
    if v_guardian.user_id is not null and v_guardian.user_id <> r.user_id then raise exception 'GUARDIAN_ALREADY_LINKED'; end if;

    select id into v_own from public.guardians where user_id = r.user_id;
    if v_own is null then
      update public.guardians set user_id = r.user_id where id = v_guardian.id;
      v_own := v_guardian.id;
    elsif v_own <> v_guardian.id then
      -- The parent already has a guardian record (e.g. for a sibling): link that record too.
      insert into public.student_guardians (student_id, guardian_id, relationship)
      values (v_student, v_own, r.relationship)
      on conflict do nothing;
    end if;
    update public.student_guardians set verified_at = now()
    where student_id = v_student and guardian_id = v_own and verified_at is null;
  end if;

  update public.guardian_link_requests
  set status = case when p_approve then 'approved' else 'rejected' end::public.correction_status,
      student_id = v_student, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = left(nullif(trim(p_note), ''), 300)
  where id = p_request;
end $$;

-- ---------- Triggers & audit -----------------------------------------------------------
do $$
declare tbl text;
begin
  foreach tbl in array array['timetable_periods', 'timetable_entries', 'learning_resources', 'guardian_link_requests'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', tbl || '_audit', tbl);
  end loop;
end $$;

-- ---------- Grants & RLS ---------------------------------------------------------------
revoke execute on function public.review_guardian_link_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_guardian_link_request(uuid, boolean, text) to authenticated;

alter table public.timetable_periods enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.learning_resources enable row level security;
alter table public.guardian_link_requests enable row level security;
revoke all on public.timetable_periods, public.timetable_entries, public.learning_resources, public.guardian_link_requests from anon;

create policy "periods: signed-in read" on public.timetable_periods for select to authenticated using (true);
create policy "periods: managers write" on public.timetable_periods for all to authenticated
  using (public.can_manage_teaching()) with check (public.can_manage_teaching());

create policy "timetable: staff, teachers, own section" on public.timetable_entries for select to authenticated
  using (
    public.has_any_role(array['super_admin', 'school_admin', 'principal', 'teacher']::public.app_role[])
    or public.has_section_member(section_id)
  );
create policy "timetable: managers write" on public.timetable_entries for all to authenticated
  using (public.can_manage_teaching()) with check (public.can_manage_teaching());

create policy "resources: staff, teachers, own class" on public.learning_resources for select to authenticated
  using (
    public.has_any_role(array['super_admin', 'school_admin', 'principal', 'teacher']::public.app_role[])
    or (is_published and public.can_access_resource(academic_year_id, class_id, medium, section_id))
  );
create policy "resources: managers or section teachers add" on public.learning_resources for insert to authenticated
  with check (public.can_manage_teaching() or (section_id is not null and public.teaches_section(section_id)));
create policy "resources: managers or uploader update" on public.learning_resources for update to authenticated
  using (public.can_manage_teaching() or uploaded_by = auth.uid())
  with check (public.can_manage_teaching() or (section_id is not null and public.teaches_section(section_id)));
create policy "resources: managers or uploader delete" on public.learning_resources for delete to authenticated
  using (public.can_manage_teaching() or uploaded_by = auth.uid());

create policy "link requests: own or managers" on public.guardian_link_requests for select to authenticated
  using (user_id = auth.uid() or public.can_manage_students());
create policy "link requests: guardians submit" on public.guardian_link_requests for insert to authenticated
  with check (public.has_role('guardian'));
revoke update, delete on public.guardian_link_requests from authenticated;

-- ---------- Private storage for learning resources ---------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learning-resources', 'learning-resources', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Readable when the caller can see the resource row that points to the file.
create policy "learning-resources: read via resource" on storage.objects for select to authenticated
  using (
    bucket_id = 'learning-resources'
    and exists (select 1 from public.learning_resources r where r.file_path = storage.objects.name)
  );
create policy "learning-resources: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'learning-resources' and (public.can_manage_teaching() or public._teaches_folder(name)));
create policy "learning-resources: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'learning-resources' and (public.can_manage_teaching() or owner = auth.uid()));
