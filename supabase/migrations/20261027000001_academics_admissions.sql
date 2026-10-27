-- =====================================================================
-- Stage 3: academic structure + online admissions.
-- Business rules (validation, numbering, status workflow) live in
-- SECURITY DEFINER functions; clients cannot write admission rows directly.
-- =====================================================================

create type public.gender as enum ('male', 'female', 'third_gender');
create type public.application_status as enum (
  'submitted', 'under_review', 'info_required', 'approved', 'rejected', 'admitted', 'withdrawn'
);

create or replace function public.is_academic_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]);
$$;

create or replace function public.is_admission_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin', 'admission_officer']::public.app_role[]);
$$;

create or replace function public.can_view_admissions()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin', 'admission_officer', 'principal']::public.app_role[]);
$$;

-- ---------- Academic structure ---------------------------------------
create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4}(-[0-9]{2,4})?$'),
  name_en text not null check (char_length(name_en) <= 50),
  name_bn text check (char_length(name_bn) <= 50),
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  admission_open boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_years_dates check (ends_on > starts_on)
);
create unique index academic_years_single_current on public.academic_years (is_current) where is_current;

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  name_en text not null check (char_length(name_en) <= 80),
  name_bn text check (char_length(name_bn) <= 80),
  starts_on date not null,
  ends_on date not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_terms_dates check (ends_on > starts_on),
  unique (academic_year_id, name_en)
);

create table public.education_streams (
  medium public.education_medium primary key,
  name_en text not null,
  name_bn text,
  is_active boolean not null default true,
  sort_order int not null default 0
);
-- The two streams are confirmed institutional facts, not sample data.
insert into public.education_streams (medium, name_en, name_bn, sort_order) values
  ('bangla_medium', 'Bangla Medium', 'বাংলা মাধ্যম', 1),
  ('english_version', 'English Version', 'ইংরেজি ভার্সন', 2);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{1,30}$'),
  name_en text not null check (char_length(name_en) <= 80),
  name_bn text check (char_length(name_bn) <= 80),
  level int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index classes_level_idx on public.classes (level);

-- Which streams offer a class, and whether that combination accepts applications.
create table public.class_streams (
  class_id uuid not null references public.classes (id) on delete cascade,
  medium public.education_medium not null references public.education_streams (medium),
  admission_open boolean not null default false,
  primary key (class_id, medium)
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id),
  class_id uuid not null references public.classes (id),
  medium public.education_medium not null,
  name text not null check (char_length(name) between 1 and 30),
  capacity int check (capacity is null or capacity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, medium) references public.class_streams (class_id, medium),
  unique (academic_year_id, class_id, medium, name)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{1,30}$'),
  name_en text not null check (char_length(name_en) <= 120),
  name_bn text check (char_length(name_bn) <= 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Subjects taught in a class, configured separately per stream.
create table public.class_subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  medium public.education_medium not null,
  subject_id uuid not null references public.subjects (id),
  is_optional boolean not null default false,
  sort_order int not null default 0,
  foreign key (class_id, medium) references public.class_streams (class_id, medium) on delete cascade,
  unique (class_id, medium, subject_id)
);

-- ---------- Generic helpers ------------------------------------------
-- Collision-free sequential numbers per scope (e.g. per academic year).
create table public.document_counters (
  scope text primary key,
  last_value int not null default 0
);

create or replace function public.next_document_number(p_scope text)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.document_counters (scope, last_value) values (p_scope, 1)
  on conflict (scope) do update set last_value = public.document_counters.last_value + 1
  returning last_value into v;
  return v;
end $$;

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);

create or replace function public.check_rate_limit(p_key text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Accepts 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX (spaces/dashes ignored).
create or replace function public.normalize_bd_phone(p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d like '880%' then d := substr(d, 3); end if;
  return case when d ~ '^01[3-9][0-9]{8}$' then d else null end;
end $$;

-- ---------- Admissions -----------------------------------------------
create table public.admission_settings (
  id boolean primary key default true check (id),
  is_open boolean not null default false,
  require_gender boolean not null default true,
  require_guardian_email boolean not null default false,
  require_previous_school boolean not null default false,
  instructions_en text,
  instructions_bn text,
  eligibility_en text,
  eligibility_bn text,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
insert into public.admission_settings default values;
create trigger admission_settings_stamp before update on public.admission_settings
  for each row execute function public.stamp_updated_by();

create table public.admission_document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{1,40}$'),
  name_en text not null check (char_length(name_en) <= 120),
  name_bn text check (char_length(name_bn) <= 120),
  description_en text,
  description_bn text,
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table public.admission_applications (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  academic_year_id uuid not null references public.academic_years (id),
  class_id uuid not null references public.classes (id),
  medium public.education_medium not null,
  student_name_en text not null check (char_length(student_name_en) between 2 and 150),
  student_name_bn text check (char_length(student_name_bn) <= 150),
  date_of_birth date not null,
  gender public.gender,
  previous_school text check (char_length(previous_school) <= 200),
  guardian_name text not null check (char_length(guardian_name) between 2 and 150),
  guardian_relationship text not null check (char_length(guardian_relationship) between 2 and 50),
  guardian_phone text not null check (guardian_phone ~ '^01[3-9][0-9]{8}$'),
  guardian_email text check (guardian_email is null or guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  present_address text not null check (char_length(present_address) between 5 and 500),
  permanent_address text not null check (char_length(permanent_address) between 5 and 500),
  status public.application_status not null default 'submitted',
  status_note text check (char_length(status_note) <= 1000),        -- shown to the applicant
  internal_notes text check (char_length(internal_notes) <= 4000),  -- staff only
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, medium) references public.class_streams (class_id, medium)
);
create index admission_applications_filter_idx on public.admission_applications (academic_year_id, status, medium, class_id);
create index admission_applications_phone_idx on public.admission_applications (guardian_phone);
create index admission_applications_name_idx on public.admission_applications (lower(student_name_en));
-- One active application per child per year (prevents double submission).
create unique index admission_applications_no_duplicates
  on public.admission_applications (academic_year_id, guardian_phone, date_of_birth, lower(student_name_en))
  where status not in ('rejected', 'withdrawn');

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.admission_applications (id) on delete cascade,
  document_type_id uuid not null references public.admission_document_types (id),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) <= 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 5242880),
  uploaded_at timestamptz not null default now()
);
create index application_documents_app_idx on public.application_documents (application_id);

create table public.admission_status_history (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.admission_applications (id) on delete cascade,
  from_status public.application_status,
  to_status public.application_status not null,
  note text,
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);
create index admission_status_history_app_idx on public.admission_status_history (application_id, changed_at);

-- Public submission. Called only by the submit-application edge function
-- (service role), after it has rate-limited the request and stored the files.
create or replace function public.submit_admission_application(p_application jsonb, p_documents jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.admission_settings;
  y public.academic_years;
  v_id uuid := gen_random_uuid();
  v_ref text;
  v_class uuid := (p_application ->> 'class_id')::uuid;
  v_medium public.education_medium := (p_application ->> 'medium')::public.education_medium;
  v_dob date := (p_application ->> 'date_of_birth')::date;
  v_phone text := public.normalize_bd_phone(p_application ->> 'guardian_phone');
  v_email text := nullif(lower(trim(p_application ->> 'guardian_email')), '');
  v_gender public.gender := nullif(p_application ->> 'gender', '')::public.gender;
  v_prev text := nullif(trim(p_application ->> 'previous_school'), '');
  v_open boolean;
begin
  select * into s from public.admission_settings;
  if not coalesce(s.is_open, false) then raise exception 'ADMISSION_CLOSED'; end if;

  select * into y from public.academic_years where id = (p_application ->> 'academic_year_id')::uuid and admission_open;
  if not found then raise exception 'INVALID_YEAR'; end if;

  select cs.admission_open into v_open
  from public.class_streams cs join public.classes c on c.id = cs.class_id
  where cs.class_id = v_class and cs.medium = v_medium and c.is_active;
  if not coalesce(v_open, false) then raise exception 'INVALID_CLASS'; end if;

  if nullif(trim(p_application ->> 'student_name_en'), '') is null
     or nullif(trim(p_application ->> 'guardian_name'), '') is null
     or nullif(trim(p_application ->> 'guardian_relationship'), '') is null
     or nullif(trim(p_application ->> 'present_address'), '') is null
     or nullif(trim(p_application ->> 'permanent_address'), '') is null then
    raise exception 'MISSING_FIELD';
  end if;
  if v_dob is null or v_dob > current_date - interval '2 years' or v_dob < current_date - interval '30 years' then
    raise exception 'INVALID_DOB';
  end if;
  if v_phone is null then raise exception 'INVALID_PHONE'; end if;
  if v_email is null and s.require_guardian_email then raise exception 'EMAIL_REQUIRED'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;
  if v_gender is null and s.require_gender then raise exception 'GENDER_REQUIRED'; end if;
  if v_prev is null and s.require_previous_school then raise exception 'PREVIOUS_SCHOOL_REQUIRED'; end if;

  if jsonb_typeof(p_documents) <> 'array' then raise exception 'INVALID_DOCUMENTS'; end if;
  if exists (
    select 1 from public.admission_document_types dt
    where dt.is_active and dt.is_required
      and not exists (select 1 from jsonb_array_elements(p_documents) d where (d ->> 'document_type_id')::uuid = dt.id)
  ) then
    raise exception 'MISSING_DOCUMENTS';
  end if;

  if exists (
    select 1 from public.admission_applications a
    where a.academic_year_id = y.id and a.guardian_phone = v_phone and a.date_of_birth = v_dob
      and lower(a.student_name_en) = lower(trim(p_application ->> 'student_name_en'))
      and a.status not in ('rejected', 'withdrawn')
  ) then
    raise exception 'DUPLICATE_APPLICATION';
  end if;

  v_ref := 'KI-APP-' || left(y.code, 4) || '-' || lpad(public.next_document_number('application:' || y.code)::text, 5, '0');

  insert into public.admission_applications (
    id, reference_no, academic_year_id, class_id, medium, student_name_en, student_name_bn,
    date_of_birth, gender, previous_school, guardian_name, guardian_relationship,
    guardian_phone, guardian_email, present_address, permanent_address
  ) values (
    v_id, v_ref, y.id, v_class, v_medium,
    trim(p_application ->> 'student_name_en'), nullif(trim(p_application ->> 'student_name_bn'), ''),
    v_dob, v_gender, v_prev,
    trim(p_application ->> 'guardian_name'), trim(p_application ->> 'guardian_relationship'),
    v_phone, v_email,
    trim(p_application ->> 'present_address'), trim(p_application ->> 'permanent_address')
  );

  insert into public.application_documents (application_id, document_type_id, storage_path, file_name, mime_type, size_bytes)
  select v_id, (d ->> 'document_type_id')::uuid, d ->> 'storage_path', left(d ->> 'file_name', 200), d ->> 'mime_type', (d ->> 'size_bytes')::int
  from jsonb_array_elements(p_documents) d;

  insert into public.admission_status_history (application_id, from_status, to_status)
  values (v_id, null, 'submitted');

  return jsonb_build_object('application_id', v_id, 'reference_no', v_ref);
end $$;

-- Private status lookup for applicants: reference + guardian phone + date of birth.
-- Rate-limited per reference so the phone/DOB pair cannot be brute-forced.
create or replace function public.lookup_admission_status(p_reference text, p_phone text, p_dob date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref text := upper(trim(coalesce(p_reference, '')));
  a record;
begin
  if v_ref !~ '^KI-APP-[0-9]{4}-[0-9]{5,}$' then return null; end if;
  if not public.check_rate_limit('lookup:' || v_ref, 10, interval '1 hour') then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  select ap.reference_no, ap.status, ap.status_note, ap.submitted_at, ap.medium,
         c.name_en as class_name_en, c.name_bn as class_name_bn,
         y.name_en as year_name_en, y.name_bn as year_name_bn
    into a
  from public.admission_applications ap
  join public.classes c on c.id = ap.class_id
  join public.academic_years y on y.id = ap.academic_year_id
  where ap.reference_no = v_ref
    and ap.guardian_phone = public.normalize_bd_phone(p_phone)
    and ap.date_of_birth = p_dob;
  if not found then return null; end if;
  return to_jsonb(a);
end $$;

create or replace function public.allowed_application_transitions(p_from public.application_status)
returns public.application_status[] language sql immutable as $$
  -- 'admitted' is set only by the student-conversion step (Stage 4), never manually.
  select case p_from
    when 'submitted' then array['under_review', 'info_required', 'rejected', 'withdrawn']
    when 'under_review' then array['info_required', 'approved', 'rejected', 'withdrawn']
    when 'info_required' then array['under_review', 'rejected', 'withdrawn']
    when 'approved' then array['under_review']
    when 'rejected' then array['under_review']
    else array[]::text[]
  end::public.application_status[];
$$;

create or replace function public.change_application_status(p_id uuid, p_status public.application_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_from public.application_status;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_admission_staff() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select status into v_from from public.admission_applications where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (p_status = any (public.allowed_application_transitions(v_from))) then
    raise exception 'INVALID_TRANSITION';
  end if;
  if p_status = 'info_required' and v_note is null then raise exception 'NOTE_REQUIRED'; end if;
  if char_length(v_note) > 1000 then raise exception 'NOTE_TOO_LONG'; end if;

  update public.admission_applications
  set status = p_status,
      status_note = v_note,
      reviewed_by = auth.uid(),
      decided_at = case when p_status in ('approved', 'rejected') then now() else decided_at end
  where id = p_id;

  insert into public.admission_status_history (application_id, from_status, to_status, note, changed_by)
  values (p_id, v_from, p_status, v_note, auth.uid());
end $$;

create or replace function public.update_application_internal_notes(p_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admission_staff() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.admission_applications set internal_notes = nullif(trim(p_notes), '') where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- ---------- Triggers ---------------------------------------------------
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'academic_years', 'academic_terms', 'classes', 'sections', 'subjects', 'admission_applications'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', tbl || '_updated_at', tbl);
  end loop;
  foreach tbl in array array[
    'academic_years', 'academic_terms', 'classes', 'class_streams', 'sections', 'subjects',
    'class_subjects', 'admission_settings', 'admission_document_types', 'admission_applications'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', tbl || '_audit', tbl);
  end loop;
end $$;

-- ---------- Grants & RLS -------------------------------------------------
revoke execute on function public.next_document_number(text) from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, int, interval) from public, anon, authenticated;
revoke execute on function public.submit_admission_application(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.next_document_number(text) to service_role;
grant execute on function public.check_rate_limit(text, int, interval) to service_role;
grant execute on function public.submit_admission_application(jsonb, jsonb) to service_role;
grant execute on function public.lookup_admission_status(text, text, date) to anon, authenticated;

alter table public.academic_years enable row level security;
alter table public.academic_terms enable row level security;
alter table public.education_streams enable row level security;
alter table public.classes enable row level security;
alter table public.class_streams enable row level security;
alter table public.sections enable row level security;
alter table public.subjects enable row level security;
alter table public.class_subjects enable row level security;
alter table public.document_counters enable row level security;
alter table public.rate_limits enable row level security;
alter table public.admission_settings enable row level security;
alter table public.admission_document_types enable row level security;
alter table public.admission_applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.admission_status_history enable row level security;

-- Academic structure is public information (used by the website and the
-- admission form); only academic administrators change it.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'academic_years', 'academic_terms', 'education_streams', 'classes', 'class_streams',
    'subjects', 'class_subjects', 'admission_document_types'
  ] loop
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', tbl || ': public read', tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_academic_admin())', tbl || ': admin insert', tbl);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_academic_admin()) with check (public.is_academic_admin())', tbl || ': admin update', tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_academic_admin())', tbl || ': admin delete', tbl);
    execute format('revoke insert, update, delete on public.%I from anon', tbl);
  end loop;
end $$;

create policy "sections: staff read" on public.sections for select to authenticated
  using (public.has_any_role(array['super_admin', 'school_admin', 'principal', 'admission_officer', 'teacher']::public.app_role[]));
create policy "sections: admin insert" on public.sections for insert to authenticated with check (public.is_academic_admin());
create policy "sections: admin update" on public.sections for update to authenticated
  using (public.is_academic_admin()) with check (public.is_academic_admin());
create policy "sections: admin delete" on public.sections for delete to authenticated using (public.is_academic_admin());
revoke insert, update, delete on public.sections from anon;

create policy "admission settings: public read" on public.admission_settings for select to anon, authenticated using (true);
create policy "admission settings: admin update" on public.admission_settings for update to authenticated
  using (public.is_academic_admin()) with check (public.is_academic_admin());
revoke insert, delete on public.admission_settings from anon, authenticated;

-- Applications: read by admission staff and the principal; all writes via functions.
create policy "applications: staff read" on public.admission_applications for select to authenticated
  using (public.can_view_admissions());
create policy "application documents: staff read" on public.application_documents for select to authenticated
  using (public.can_view_admissions());
create policy "application history: staff read" on public.admission_status_history for select to authenticated
  using (public.can_view_admissions());
revoke insert, update, delete on public.admission_applications from anon, authenticated;
revoke insert, update, delete on public.application_documents from anon, authenticated;
revoke insert, update, delete on public.admission_status_history from anon, authenticated;
revoke all on public.document_counters from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;

-- ---------- Private storage for admission documents ------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admission-documents', 'admission-documents', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Staff may read (and create signed URLs for) documents; only the service
-- role (edge function) writes. No public access at all.
create policy "admission-documents: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'admission-documents' and public.can_view_admissions());
