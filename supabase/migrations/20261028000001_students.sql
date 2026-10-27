-- =====================================================================
-- Stage 4: students, guardians, enrollments, student documents.
-- History is preserved: enrollments are never overwritten or deleted, and
-- status changes / promotions go through functions that run as one
-- transaction. Student and guardian portal access (Stage 8) is already
-- enforced here through verified guardian links.
-- =====================================================================

create type public.student_status as enum ('active', 'transferred', 'withdrawn', 'graduated');
create type public.enrollment_status as enum ('enrolled', 'promoted', 'retained', 'transferred', 'withdrawn', 'graduated');

create or replace function public.can_view_students()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin', 'principal', 'admission_officer']::public.app_role[]);
$$;

create or replace function public.can_manage_students()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]);
$$;

-- Sequential number padded to at least `width` digits (never truncated).
create or replace function public.pad_number(n int, width int)
returns text language sql immutable as $$
  select lpad(n::text, greatest(width, length(n::text)), '0');
$$;

-- ---------- Tables ----------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  student_code text not null unique,            -- human-readable student ID, e.g. KI20270001
  admission_no text not null unique,            -- e.g. KI-ADM-2027-00001
  application_id uuid unique references public.admission_applications (id),
  user_id uuid unique references public.user_profiles (id) on delete set null,  -- student portal account
  name_en text not null check (char_length(name_en) between 2 and 150),
  name_bn text check (char_length(name_bn) <= 150),
  date_of_birth date not null,
  gender public.gender,
  medium public.education_medium not null references public.education_streams (medium),
  status public.student_status not null default 'active',
  admission_date date not null default current_date,
  left_on date,
  leave_reason text check (char_length(leave_reason) <= 500),
  previous_school text check (char_length(previous_school) <= 200),
  present_address text check (char_length(present_address) <= 500),
  permanent_address text check (char_length(permanent_address) <= 500),
  emergency_contact_name text check (char_length(emergency_contact_name) <= 150),
  emergency_contact_phone text check (emergency_contact_phone is null or emergency_contact_phone ~ '^01[3-9][0-9]{8}$'),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_name_idx on public.students (lower(name_en));
create index students_status_idx on public.students (status);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 150),
  phone text not null check (phone ~ '^01[3-9][0-9]{8}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text check (char_length(address) <= 500),
  user_id uuid unique references public.user_profiles (id) on delete set null,  -- parent portal account
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index guardians_phone_idx on public.guardians (phone);

-- A guardian sees a child only through a VERIFIED link created by staff.
create table public.student_guardians (
  student_id uuid not null references public.students (id),
  guardian_id uuid not null references public.guardians (id),
  relationship text not null check (char_length(relationship) between 2 and 50),
  is_primary boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users (id),
  primary key (student_id, guardian_id)
);
create unique index student_guardians_one_primary on public.student_guardians (student_id) where is_primary;
create index student_guardians_guardian_idx on public.student_guardians (guardian_id);

create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  academic_year_id uuid not null references public.academic_years (id),
  class_id uuid not null references public.classes (id),
  medium public.education_medium not null,
  section_id uuid references public.sections (id),
  roll_no int check (roll_no is null or roll_no > 0),
  status public.enrollment_status not null default 'enrolled',
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, medium) references public.class_streams (class_id, medium),
  unique (student_id, academic_year_id)
);
create index student_enrollments_year_idx on public.student_enrollments (academic_year_id, class_id, medium, section_id);
create unique index student_enrollments_roll_unique
  on public.student_enrollments (section_id, roll_no) where section_id is not null and roll_no is not null;

create table public.student_documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  title text not null check (char_length(title) between 1 and 150),
  bucket text not null check (bucket in ('student-documents', 'admission-documents')),
  storage_path text not null,
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 5242880),
  uploaded_by uuid references auth.users (id),
  uploaded_at timestamptz not null default now(),
  unique (bucket, storage_path)
);
create index student_documents_student_idx on public.student_documents (student_id);

-- ---------- Integrity triggers -----------------------------------------------
-- Identifiers never change; status changes must go through change_student_status().
create or replace function public.guard_student_update()
returns trigger language plpgsql as $$
begin
  if new.student_code <> old.student_code or new.admission_no <> old.admission_no
     or new.application_id is distinct from old.application_id then
    raise exception 'IMMUTABLE_FIELD';
  end if;
  if (new.status <> old.status or new.left_on is distinct from old.left_on)
     and coalesce(current_setting('app.status_change', true), '') <> 'on' then
    raise exception 'USE_STATUS_FUNCTION';
  end if;
  return new;
end $$;
create trigger students_guard before update on public.students
  for each row execute function public.guard_student_update();

create or replace function public.guard_enrollment()
returns trigger language plpgsql as $$
begin
  if new.section_id is not null and not exists (
    select 1 from public.sections s
    where s.id = new.section_id and s.academic_year_id = new.academic_year_id
      and s.class_id = new.class_id and s.medium = new.medium
  ) then
    raise exception 'SECTION_MISMATCH';
  end if;
  if tg_op = 'UPDATE'
     and (new.status <> old.status or new.student_id <> old.student_id or new.academic_year_id <> old.academic_year_id)
     and coalesce(current_setting('app.status_change', true), '') <> 'on' then
    raise exception 'USE_STATUS_FUNCTION';
  end if;
  return new;
end $$;
create trigger student_enrollments_guard before insert or update on public.student_enrollments
  for each row execute function public.guard_enrollment();

-- Who linked / verified a guardian is always the acting user.
create or replace function public.stamp_student_guardian()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.verified_at is not null then
      new.verified_at := now();
      new.verified_by := auth.uid();
    else
      new.verified_by := null;
    end if;
  elsif new.verified_at is distinct from old.verified_at then
    if new.verified_at is null then
      new.verified_by := null;
    else
      new.verified_at := now();
      new.verified_by := auth.uid();
    end if;
  end if;
  return new;
end $$;
create trigger student_guardians_stamp before insert or update on public.student_guardians
  for each row execute function public.stamp_student_guardian();

create or replace function public.stamp_uploaded_by()
returns trigger language plpgsql as $$
begin
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  return new;
end $$;
create trigger student_documents_stamp before insert on public.student_documents
  for each row when (current_setting('app.status_change', true) is distinct from 'on')
  execute function public.stamp_uploaded_by();

-- ---------- Portal access helpers ---------------------------------------------
create or replace function public.is_guardian_of(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('guardian') and exists (
    select 1 from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = p_student and g.user_id = auth.uid() and sg.verified_at is not null
  );
$$;

create or replace function public.is_student_self(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('student') and exists (
    select 1 from public.students s where s.id = p_student and s.user_id = auth.uid()
  );
$$;

-- ---------- Core creation (internal) --------------------------------------------
create or replace function public._create_student(
  p_year uuid, p_class uuid, p_medium public.education_medium, p_section uuid, p_roll int,
  p_name_en text, p_name_bn text, p_dob date, p_gender public.gender, p_admission_date date,
  p_previous_school text, p_present text, p_permanent text, p_application uuid,
  p_guardian_name text, p_guardian_relationship text, p_guardian_phone text, p_guardian_email text,
  p_guardian_verified boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  y public.academic_years;
  v_id uuid := gen_random_uuid();
  v_year text;
  v_phone text := public.normalize_bd_phone(p_guardian_phone);
  v_guardian uuid;
begin
  select * into y from public.academic_years where id = p_year;
  if not found then raise exception 'INVALID_YEAR'; end if;
  if not exists (select 1 from public.class_streams where class_id = p_class and medium = p_medium) then
    raise exception 'INVALID_CLASS';
  end if;
  if nullif(trim(p_name_en), '') is null or p_dob is null
     or nullif(trim(p_guardian_name), '') is null or nullif(trim(p_guardian_relationship), '') is null then
    raise exception 'MISSING_FIELD';
  end if;
  if v_phone is null then raise exception 'INVALID_PHONE'; end if;
  v_year := left(y.code, 4);

  insert into public.students (
    id, student_code, admission_no, application_id, name_en, name_bn, date_of_birth, gender, medium,
    admission_date, previous_school, present_address, permanent_address
  ) values (
    v_id,
    'KI' || v_year || public.pad_number(public.next_document_number('student:' || v_year), 4),
    'KI-ADM-' || v_year || '-' || public.pad_number(public.next_document_number('admission:' || v_year), 5),
    p_application, trim(p_name_en), nullif(trim(p_name_bn), ''), p_dob, p_gender, p_medium,
    coalesce(p_admission_date, current_date), nullif(trim(p_previous_school), ''),
    nullif(trim(p_present), ''), nullif(trim(p_permanent), '')
  );

  insert into public.student_enrollments (student_id, academic_year_id, class_id, medium, section_id, roll_no, start_date)
  values (v_id, p_year, p_class, p_medium, p_section, p_roll, coalesce(p_admission_date, current_date));

  -- Siblings share a guardian record when name and phone match.
  select id into v_guardian from public.guardians
  where phone = v_phone and lower(name) = lower(trim(p_guardian_name))
  limit 1;
  if v_guardian is null then
    insert into public.guardians (name, phone, email, address)
    values (trim(p_guardian_name), v_phone, nullif(lower(trim(p_guardian_email)), ''), nullif(trim(p_present), ''))
    returning id into v_guardian;
  end if;

  insert into public.student_guardians (student_id, guardian_id, relationship, is_primary, verified_at)
  values (v_id, v_guardian, trim(p_guardian_relationship), true, case when p_guardian_verified then now() end);

  return v_id;
end $$;

-- ---------- Public functions -----------------------------------------------------
-- Converts an approved application into a student. Idempotent: a second call
-- returns the student already created for that application.
create or replace function public.admit_applicant(
  p_application_id uuid, p_section_id uuid default null, p_admission_date date default null,
  p_guardian_verified boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  a public.admission_applications;
  v_student uuid;
begin
  if not public.is_admission_staff() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into a from public.admission_applications where id = p_application_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select id into v_student from public.students where application_id = a.id;
  if v_student is not null then return v_student; end if;
  if a.status <> 'approved' then raise exception 'APPLICATION_NOT_APPROVED'; end if;

  v_student := public._create_student(
    a.academic_year_id, a.class_id, a.medium, p_section_id, null,
    a.student_name_en, a.student_name_bn, a.date_of_birth, a.gender, p_admission_date,
    a.previous_school, a.present_address, a.permanent_address, a.id,
    a.guardian_name, a.guardian_relationship, a.guardian_phone, a.guardian_email, p_guardian_verified
  );

  -- Admission documents stay in their private bucket; the student record references them.
  perform set_config('app.status_change', 'on', true);
  insert into public.student_documents (student_id, title, bucket, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at)
  select v_student, dt.name_en, 'admission-documents', d.storage_path, d.file_name, d.mime_type, d.size_bytes, null, d.uploaded_at
  from public.application_documents d
  join public.admission_document_types dt on dt.id = d.document_type_id
  where d.application_id = a.id;
  perform set_config('app.status_change', '', true);

  update public.admission_applications
  set status = 'admitted', reviewed_by = auth.uid(), decided_at = now()
  where id = a.id;
  insert into public.admission_status_history (application_id, from_status, to_status, changed_by)
  values (a.id, 'approved', 'admitted', auth.uid());

  return v_student;
end $$;

-- Adds an existing or directly admitted student (no online application).
create or replace function public.create_student(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_students() then raise exception 'Not authorised' using errcode = '42501'; end if;
  v_id := public._create_student(
    (p ->> 'academic_year_id')::uuid, (p ->> 'class_id')::uuid, (p ->> 'medium')::public.education_medium,
    nullif(p ->> 'section_id', '')::uuid, nullif(p ->> 'roll_no', '')::int,
    p ->> 'name_en', p ->> 'name_bn', (p ->> 'date_of_birth')::date, nullif(p ->> 'gender', '')::public.gender,
    nullif(p ->> 'admission_date', '')::date,
    p ->> 'previous_school', p ->> 'present_address', p ->> 'permanent_address', null,
    p ->> 'guardian_name', p ->> 'guardian_relationship', p ->> 'guardian_phone', p ->> 'guardian_email',
    true
  );
  return jsonb_build_object('id', v_id, 'student_code', (select student_code from public.students where id = v_id));
end $$;

-- Enrolls an active student in a (new) academic year, e.g. after re-admission.
create or replace function public.enroll_student(
  p_student uuid, p_year uuid, p_class uuid, p_section uuid default null, p_roll int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare s public.students; v_id uuid; y public.academic_years;
begin
  if not public.can_manage_students() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.status <> 'active' then raise exception 'STUDENT_NOT_ACTIVE'; end if;
  select * into y from public.academic_years where id = p_year;
  if not found then raise exception 'INVALID_YEAR'; end if;
  if not exists (select 1 from public.class_streams where class_id = p_class and medium = s.medium) then
    raise exception 'INVALID_CLASS';
  end if;
  if exists (select 1 from public.student_enrollments where student_id = p_student and academic_year_id = p_year) then
    raise exception 'ALREADY_ENROLLED';
  end if;
  insert into public.student_enrollments (student_id, academic_year_id, class_id, medium, section_id, roll_no, start_date)
  values (p_student, p_year, p_class, s.medium, p_section, p_roll, greatest(y.starts_on, current_date))
  returning id into v_id;
  return v_id;
end $$;

-- Links a guardian (reusing an existing record with the same name and phone).
-- New links start UNVERIFIED; verification is a separate, deliberate step.
create or replace function public.link_guardian(
  p_student uuid, p_name text, p_phone text, p_email text, p_relationship text, p_primary boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_bd_phone(p_phone);
  v_guardian uuid;
begin
  if not public.can_manage_students() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.students where id = p_student) then raise exception 'NOT_FOUND'; end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_relationship), '') is null then raise exception 'MISSING_FIELD'; end if;
  if v_phone is null then raise exception 'INVALID_PHONE'; end if;

  select id into v_guardian from public.guardians where phone = v_phone and lower(name) = lower(trim(p_name)) limit 1;
  if v_guardian is null then
    insert into public.guardians (name, phone, email) values (trim(p_name), v_phone, nullif(lower(trim(p_email)), ''))
    returning id into v_guardian;
  end if;
  if exists (select 1 from public.student_guardians where student_id = p_student and guardian_id = v_guardian) then
    raise exception 'ALREADY_LINKED';
  end if;
  if p_primary then
    update public.student_guardians set is_primary = false where student_id = p_student and is_primary;
  end if;
  insert into public.student_guardians (student_id, guardian_id, relationship, is_primary)
  values (p_student, v_guardian, trim(p_relationship), p_primary);
  return v_guardian;
end $$;

-- Transfer, withdrawal, graduation or reactivation; closes the open enrollment.
create or replace function public.change_student_status(
  p_student uuid, p_status public.student_status, p_date date default null, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_old public.student_status;
begin
  if not public.can_manage_students() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select status into v_old from public.students where id = p_student for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_old = p_status then raise exception 'NO_CHANGE'; end if;
  if p_status <> 'active' and nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED'; end if;

  perform set_config('app.status_change', 'on', true);
  update public.students
  set status = p_status,
      left_on = case when p_status = 'active' then null else coalesce(p_date, current_date) end,
      leave_reason = case when p_status = 'active' then null else left(trim(p_reason), 500) end
  where id = p_student;
  if p_status <> 'active' then
    update public.student_enrollments
    set status = p_status::text::public.enrollment_status, end_date = coalesce(p_date, current_date)
    where student_id = p_student and status = 'enrolled';
  end if;
  perform set_config('app.status_change', '', true);
end $$;

-- Year-end processing for many students at once, all-or-nothing.
-- p_items: [{ "student_id", "action": "promote"|"retain"|"graduate", "class_id"?, "section_id"? }]
create or replace function public.promote_students(p_from_year uuid, p_to_year uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  yf public.academic_years;
  yt public.academic_years;
  item record;
  e public.student_enrollments;
  v_class uuid;
  n int := 0;
begin
  if not public.can_manage_students() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into yf from public.academic_years where id = p_from_year;
  select * into yt from public.academic_years where id = p_to_year;
  if yf.id is null or yt.id is null then raise exception 'INVALID_YEAR'; end if;
  if yt.starts_on <= yf.starts_on then raise exception 'TARGET_YEAR_NOT_LATER'; end if;

  perform set_config('app.status_change', 'on', true);
  for item in
    select * from jsonb_to_recordset(p_items) as x(student_id uuid, action text, class_id uuid, section_id uuid)
  loop
    select * into e from public.student_enrollments
    where student_id = item.student_id and academic_year_id = p_from_year for update;
    if not found or e.status <> 'enrolled' then raise exception 'NOT_ENROLLED'; end if;

    if item.action = 'graduate' then
      update public.student_enrollments set status = 'graduated', end_date = yf.ends_on where id = e.id;
      update public.students set status = 'graduated', left_on = yf.ends_on, leave_reason = 'Graduated'
      where id = e.student_id;
    elsif item.action in ('promote', 'retain') then
      v_class := case when item.action = 'retain' then e.class_id else item.class_id end;
      if v_class is null then raise exception 'MISSING_CLASS'; end if;
      if not exists (select 1 from public.class_streams where class_id = v_class and medium = e.medium) then
        raise exception 'INVALID_CLASS';
      end if;
      update public.student_enrollments
      set status = case when item.action = 'retain' then 'retained' else 'promoted' end::public.enrollment_status,
          end_date = yf.ends_on
      where id = e.id;
      insert into public.student_enrollments (student_id, academic_year_id, class_id, medium, section_id, start_date)
      values (e.student_id, p_to_year, v_class, e.medium, item.section_id, yt.starts_on);
    else
      raise exception 'INVALID_ACTION';
    end if;
    n := n + 1;
  end loop;
  perform set_config('app.status_change', '', true);
  return n;
end $$;

-- ---------- Triggers: timestamps & audit --------------------------------------------
do $$
declare tbl text;
begin
  foreach tbl in array array['students', 'guardians', 'student_enrollments'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', tbl || '_updated_at', tbl);
  end loop;
  foreach tbl in array array['students', 'guardians', 'student_guardians', 'student_enrollments', 'student_documents'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', tbl || '_audit', tbl);
  end loop;
end $$;

-- ---------- Grants & RLS ------------------------------------------------------------
revoke execute on function public._create_student(uuid, uuid, public.education_medium, uuid, int, text, text, date, public.gender, date, text, text, text, uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.admit_applicant(uuid, uuid, date, boolean) from public, anon;
revoke execute on function public.create_student(jsonb) from public, anon;
revoke execute on function public.enroll_student(uuid, uuid, uuid, uuid, int) from public, anon;
revoke execute on function public.change_student_status(uuid, public.student_status, date, text) from public, anon;
revoke execute on function public.promote_students(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.link_guardian(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.link_guardian(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.admit_applicant(uuid, uuid, date, boolean) to authenticated;
grant execute on function public.create_student(jsonb) to authenticated;
grant execute on function public.enroll_student(uuid, uuid, uuid, uuid, int) to authenticated;
grant execute on function public.change_student_status(uuid, public.student_status, date, text) to authenticated;
grant execute on function public.promote_students(uuid, uuid, jsonb) to authenticated;

alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.student_guardians enable row level security;
alter table public.student_enrollments enable row level security;
alter table public.student_documents enable row level security;

-- Nothing here is ever visible to anonymous visitors.
revoke all on public.students, public.guardians, public.student_guardians, public.student_enrollments, public.student_documents from anon;
-- Records are created only through the functions above and never deleted (history).
revoke insert, delete on public.students, public.student_enrollments from authenticated;

create policy "students: staff, self or verified guardian" on public.students for select to authenticated
  using (public.can_view_students() or public.is_student_self(id) or public.is_guardian_of(id));
create policy "students: managers update" on public.students for update to authenticated
  using (public.can_manage_students()) with check (public.can_manage_students());

create policy "enrollments: staff, self or verified guardian" on public.student_enrollments for select to authenticated
  using (public.can_view_students() or public.is_student_self(student_id) or public.is_guardian_of(student_id));
create policy "enrollments: managers update" on public.student_enrollments for update to authenticated
  using (public.can_manage_students()) with check (public.can_manage_students());

create policy "guardians: staff or self" on public.guardians for select to authenticated
  using (public.can_view_students() or (user_id = auth.uid() and public.has_role('guardian')));
create policy "guardians: managers insert" on public.guardians for insert to authenticated with check (public.can_manage_students());
create policy "guardians: managers update" on public.guardians for update to authenticated
  using (public.can_manage_students()) with check (public.can_manage_students());
create policy "guardians: managers delete" on public.guardians for delete to authenticated using (public.can_manage_students());

create policy "student guardians: staff or own verified links" on public.student_guardians for select to authenticated
  using (
    public.can_view_students()
    or (verified_at is not null and public.has_role('guardian')
        and exists (select 1 from public.guardians g where g.id = guardian_id and g.user_id = auth.uid()))
  );
create policy "student guardians: managers insert" on public.student_guardians for insert to authenticated with check (public.can_manage_students());
create policy "student guardians: managers update" on public.student_guardians for update to authenticated
  using (public.can_manage_students()) with check (public.can_manage_students());
create policy "student guardians: managers delete" on public.student_guardians for delete to authenticated using (public.can_manage_students());

create policy "student documents: staff read" on public.student_documents for select to authenticated using (public.can_view_students());
create policy "student documents: managers insert" on public.student_documents for insert to authenticated
  with check (public.can_manage_students() and bucket = 'student-documents');
create policy "student documents: managers delete" on public.student_documents for delete to authenticated
  using (public.can_manage_students() and bucket = 'student-documents');

-- ---------- Private storage for student documents --------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-documents', 'student-documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "student-documents: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'student-documents' and public.can_view_students());
create policy "student-documents: managers upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'student-documents' and public.can_manage_students());
create policy "student-documents: managers delete" on storage.objects for delete to authenticated
  using (bucket_id = 'student-documents' and public.can_manage_students());
