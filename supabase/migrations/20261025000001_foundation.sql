-- =====================================================================
-- Stage 1 foundation: roles, profiles, institution settings, public
-- content (notices, events, gallery, documents), audit log, storage.
-- Every table has RLS enabled; private access is default-deny.
-- =====================================================================

-- ---------- Enums ----------------------------------------------------
create type public.app_role as enum (
  'super_admin', 'school_admin', 'principal', 'accounts_officer',
  'admission_officer', 'teacher', 'student', 'guardian'
);
create type public.content_status as enum ('draft', 'published', 'archived');
create type public.content_language as enum ('bn', 'en', 'both');
create type public.education_medium as enum ('bangla_medium', 'english_version');
create type public.notice_category as enum (
  'general', 'admission', 'examination', 'holiday', 'event', 'parent_meeting', 'academic'
);
create type public.event_type as enum (
  'academic', 'examination', 'holiday', 'parent_meeting', 'cultural', 'sports', 'general'
);

-- ---------- Shared trigger helpers -----------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Profiles & roles ----------------------------------------
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 150),
  phone text check (phone is null or phone ~ '^[0-9+ -]{6,20}$'),
  preferred_language text not null default 'bn' check (preferred_language in ('bn', 'en')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_profiles_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id)
);
create unique index role_assignments_active_uq
  on public.role_assignments (user_id, role) where revoked_at is null;
create index role_assignments_user_idx on public.role_assignments (user_id);

-- Role checks read the database, never JWT/user metadata, so changes apply
-- on the next request. SECURITY DEFINER avoids recursive RLS evaluation.
create or replace function public.has_role(_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.role_assignments ra
    join public.user_profiles up on up.id = ra.user_id
    where ra.user_id = auth.uid()
      and ra.role = _role
      and ra.revoked_at is null
      and up.is_active
  );
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.role_assignments ra
    join public.user_profiles up on up.id = ra.user_id
    where ra.user_id = auth.uid()
      and ra.role = any (_roles)
      and ra.revoked_at is null
      and up.is_active
  );
$$;

create or replace function public.is_content_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]);
$$;

-- New auth users get a profile only. Roles are never derived from signup metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 150))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Grantor / revoker are always the acting user, regardless of client input.
create or replace function public.stamp_role_assignment()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.granted_by := auth.uid();
    new.granted_at := now();
    new.revoked_at := null;
    new.revoked_by := null;
  elsif tg_op = 'UPDATE' then
    if old.revoked_at is not null then
      raise exception 'Revoked role assignments cannot be changed';
    end if;
    if new.revoked_at is not null then
      new.revoked_at := now();
      new.revoked_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

create trigger role_assignments_stamp before insert or update on public.role_assignments
  for each row execute function public.stamp_role_assignment();

-- Deactivation is a privileged operation, so it goes through a checked function
-- instead of a column grant that every authenticated user would share.
create or replace function public.set_user_active(_user_id uuid, _active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot change your own account status' using errcode = '42501';
  end if;
  if not public.has_role('super_admin') and exists (
    select 1 from public.role_assignments
    where user_id = _user_id and role = 'super_admin' and revoked_at is null
  ) then
    raise exception 'Only a super administrator can change another super administrator' using errcode = '42501';
  end if;
  update public.user_profiles set is_active = _active where id = _user_id;
end $$;

revoke execute on function public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;

-- ---------- Institution settings (single row) ------------------------
create table public.institution_settings (
  id boolean primary key default true check (id),
  name_en text not null check (char_length(name_en) <= 200),
  name_bn text check (char_length(name_bn) <= 200),
  address_en text not null,
  address_bn text,
  phone text not null,
  whatsapp text,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  about_en text,
  about_bn text,
  mission_en text,
  mission_bn text,
  vision_en text,
  vision_bn text,
  eiin text check (eiin is null or eiin ~ '^[0-9]{6}$'),
  established_year int check (established_year is null or established_year between 1800 and 2100),
  board_affiliation text,
  office_hours_en text,
  office_hours_bn text,
  logo_path text,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create or replace function public.stamp_updated_by()
returns trigger language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger institution_settings_stamp before update on public.institution_settings
  for each row execute function public.stamp_updated_by();

-- Supplied, verified institutional information. Bengali text is a translation
-- pending confirmation by the institution. EIIN / year / board left NULL on purpose.
insert into public.institution_settings (
  name_en, name_bn, address_en, address_bn, phone, whatsapp, email,
  about_en, about_bn, mission_en, mission_bn, vision_en, vision_bn
) values (
  'Knowledge Inn International School and College',
  'নলেজ ইন ইন্টারন্যাশনাল স্কুল অ্যান্ড কলেজ',
  'Tushar Dhara Avenue, New Road, Jatrabari, Dhaka-1236, Bangladesh.',
  'তুষার ধারা অ্যাভিনিউ, নিউ রোড, যাত্রাবাড়ী, ঢাকা-১২৩৬, বাংলাদেশ।',
  '01301461643',
  '01301461643',
  'kamrul336@gmail.com',
  'We are committed to providing quality education that nurtures academic excellence, creativity, discipline, and moral values.',
  'আমরা মানসম্মত শিক্ষা প্রদানে অঙ্গীকারবদ্ধ, যা একাডেমিক উৎকর্ষ, সৃজনশীলতা, শৃঙ্খলা ও নৈতিক মূল্যবোধ বিকশিত করে।',
  'To deliver student-centred education that develops knowledge, skills, confidence, and integrity.',
  'শিক্ষার্থীকেন্দ্রিক শিক্ষা প্রদান করা, যা জ্ঞান, দক্ষতা, আত্মবিশ্বাস ও সততা বিকশিত করে।',
  'To become a centre of educational excellence, preparing globally competent, responsible, and lifelong learners.',
  'শিক্ষায় উৎকর্ষের কেন্দ্র হয়ে ওঠা এবং বৈশ্বিকভাবে যোগ্য, দায়িত্বশীল ও আজীবন শিক্ষার্থী গড়ে তোলা।'
);

-- ---------- Public content -------------------------------------------
create or replace function public.stamp_author()
returns trigger language plpgsql as $$
begin
  new.author_id := auth.uid();
  return new;
end $$;

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title_en text check (char_length(title_en) <= 300),
  title_bn text check (char_length(title_bn) <= 300),
  body_en text,
  body_bn text,
  category public.notice_category not null default 'general',
  language public.content_language not null default 'both',
  target_medium public.education_medium,          -- NULL = all streams
  status public.content_status not null default 'draft',
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  attachment_path text,
  author_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notices_has_title check (coalesce(title_en, title_bn) is not null),
  constraint notices_expiry_after_publish check (expires_at is null or expires_at > publish_at)
);
create index notices_public_idx on public.notices (status, publish_at desc);
create index notices_category_idx on public.notices (category);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title_en text check (char_length(title_en) <= 300),
  title_bn text check (char_length(title_bn) <= 300),
  description_en text,
  description_bn text,
  event_type public.event_type not null default 'general',
  target_medium public.education_medium,
  starts_on date not null,
  ends_on date,
  location text check (char_length(location) <= 200),
  status public.content_status not null default 'draft',
  author_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_has_title check (coalesce(title_en, title_bn) is not null),
  constraint events_dates check (ends_on is null or ends_on >= starts_on)
);
create index events_public_idx on public.events (status, starts_on);

create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  title_en text check (char_length(title_en) <= 200),
  title_bn text check (char_length(title_bn) <= 200),
  image_path text not null,
  album text check (char_length(album) <= 100),
  taken_on date,
  sort_order int not null default 0,
  status public.content_status not null default 'draft',
  author_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gallery_items_public_idx on public.gallery_items (status, sort_order);

create table public.downloadable_documents (
  id uuid primary key default gen_random_uuid(),
  title_en text check (char_length(title_en) <= 300),
  title_bn text check (char_length(title_bn) <= 300),
  description_en text,
  description_bn text,
  file_path text not null,
  category text check (char_length(category) <= 100),
  status public.content_status not null default 'draft',
  publish_at timestamptz not null default now(),
  author_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_has_title check (coalesce(title_en, title_bn) is not null)
);
create index downloadable_documents_public_idx on public.downloadable_documents (status, publish_at desc);

do $$
declare tbl text;
begin
  foreach tbl in array array['notices', 'events', 'gallery_items', 'downloadable_documents'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', tbl || '_updated_at', tbl);
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_author()', tbl || '_author', tbl);
  end loop;
end $$;

-- ---------- Audit log -----------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  changed_fields text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

-- Records who changed what and which fields, without copying field values
-- (which may contain personal data) into the log.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key)
      and n.key not in ('updated_at', 'updated_by');
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, changed_fields, metadata)
  values (
    auth.uid(), lower(tg_op), tg_table_name, rec ->> 'id', changed,
    case when tg_table_name = 'role_assignments'
      then jsonb_build_object('user_id', rec ->> 'user_id', 'role', rec ->> 'role')
      else '{}'::jsonb end
  );
  return coalesce(new, old);
end $$;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'user_profiles', 'role_assignments', 'institution_settings',
    'notices', 'events', 'gallery_items', 'downloadable_documents'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', tbl || '_audit', tbl);
  end loop;
end $$;

-- ---------- Row Level Security --------------------------------------
alter table public.user_profiles enable row level security;
alter table public.role_assignments enable row level security;
alter table public.institution_settings enable row level security;
alter table public.notices enable row level security;
alter table public.events enable row level security;
alter table public.gallery_items enable row level security;
alter table public.downloadable_documents enable row level security;
alter table public.audit_logs enable row level security;

-- user_profiles: own row, or user-administering staff.
create policy "profiles: read own or as admin" on public.user_profiles
  for select to authenticated
  using (id = auth.uid() or public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]));
create policy "profiles: update own" on public.user_profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Users may edit only these columns of their own profile (not is_active).
revoke insert, update, delete on public.user_profiles from anon, authenticated;
grant update (full_name, phone, preferred_language) on public.user_profiles to authenticated;

-- role_assignments: only super admins grant/revoke, never for themselves; no deletes.
create policy "roles: read own or as admin" on public.role_assignments
  for select to authenticated
  using (user_id = auth.uid() or public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]));
create policy "roles: super admin grants to others" on public.role_assignments
  for insert to authenticated
  with check (public.has_role('super_admin') and user_id <> auth.uid());
create policy "roles: super admin revokes for others" on public.role_assignments
  for update to authenticated
  using (public.has_role('super_admin') and user_id <> auth.uid())
  with check (public.has_role('super_admin') and user_id <> auth.uid());
revoke delete on public.role_assignments from anon, authenticated;
revoke update on public.role_assignments from anon, authenticated;
grant update (revoked_at) on public.role_assignments to authenticated;

-- institution_settings: public read, super admin update, no insert/delete.
create policy "settings: public read" on public.institution_settings
  for select to anon, authenticated using (true);
create policy "settings: super admin update" on public.institution_settings
  for update to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));
revoke insert, delete on public.institution_settings from anon, authenticated;

-- Public content: anyone reads published & current; content managers manage all.
create policy "notices: public read published" on public.notices
  for select to anon, authenticated
  using (status = 'published' and publish_at <= now() and (expires_at is null or expires_at > now()));
create policy "events: public read published" on public.events
  for select to anon, authenticated using (status = 'published');
create policy "gallery: public read published" on public.gallery_items
  for select to anon, authenticated using (status = 'published');
create policy "documents: public read published" on public.downloadable_documents
  for select to anon, authenticated using (status = 'published' and publish_at <= now());

do $$
declare tbl text;
begin
  foreach tbl in array array['notices', 'events', 'gallery_items', 'downloadable_documents'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_content_manager())', tbl || ': managers read all', tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_content_manager())', tbl || ': managers insert', tbl);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_content_manager()) with check (public.is_content_manager())', tbl || ': managers update', tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_content_manager())', tbl || ': managers delete', tbl);
    execute format('revoke insert, update, delete on public.%I from anon', tbl);
  end loop;
end $$;

-- audit_logs: super admins read; nobody writes or edits through the API.
create policy "audit: super admin read" on public.audit_logs
  for select to authenticated using (public.has_role('super_admin'));
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;

-- ---------- Storage: approved public assets only ---------------------
-- Confidential files (admission documents, student records) will use a
-- separate PRIVATE bucket with signed URLs in a later stage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-assets', 'public-assets', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "public-assets: managers upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'public-assets' and public.is_content_manager());
create policy "public-assets: managers update" on storage.objects
  for update to authenticated
  using (bucket_id = 'public-assets' and public.is_content_manager())
  with check (bucket_id = 'public-assets' and public.is_content_manager());
create policy "public-assets: managers delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'public-assets' and public.is_content_manager());
