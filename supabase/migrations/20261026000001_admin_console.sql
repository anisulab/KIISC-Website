-- =====================================================================
-- Stage 2: admin console support.
-- Adds a mirrored email column so administrators can find users, and keeps
-- it in sync with auth.users. Visibility follows the existing profile RLS
-- (own row, or super/school administrators).
-- =====================================================================

alter table public.user_profiles add column email text;

update public.user_profiles p
set email = u.email
from auth.users u
where u.id = p.id;

create index user_profiles_email_idx on public.user_profiles (lower(email));
create index user_profiles_name_idx on public.user_profiles (lower(full_name));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, full_name, email)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 150), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.sync_user_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.user_profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_user_email();

-- The email column is managed by the trigger only; the existing column grant
-- (full_name, phone, preferred_language) already prevents client edits.

-- Uploaded public files must live under a known folder, so stray uploads
-- (e.g. a mistaken student document) are easy to find and audit.
drop policy "public-assets: managers upload" on storage.objects;
create policy "public-assets: managers upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'public-assets'
    and public.is_content_manager()
    and (storage.foldername(name))[1] in ('notices', 'events', 'gallery', 'documents', 'branding')
  );
