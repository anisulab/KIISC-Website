-- =====================================================================
-- Stage 10: hardening.
-- * Two-step verification (MFA) for staff, enforced in the database: once
--   switched on, staff roles only count in sessions verified with a second
--   factor (JWT claim aal = aal2). Students, guardians and teachers are not
--   affected.
-- * Report exports are rate-limited per user.
-- * Integrity report and data fingerprint for backup/restore drills.
-- * Tighter grants: anonymous visitors lose rights they never needed.
-- =====================================================================

-- ---------- MFA policy -----------------------------------------------------------------
create table public.security_settings (
  id boolean primary key default true check (id),
  require_staff_mfa boolean not null default false,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
insert into public.security_settings default values;

create or replace function public._is_staff_role(p_role public.app_role)
returns boolean language sql immutable as $$
  select p_role in ('super_admin', 'school_admin', 'principal', 'accounts_officer', 'admission_officer');
$$;

-- True unless staff MFA is required and this session has not passed a second factor.
create or replace function public._staff_mfa_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce((select require_staff_mfa from public.security_settings), false)
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Same contract as before; staff roles additionally need MFA when the policy is on.
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
      and (not public._is_staff_role(ra.role) or public._staff_mfa_ok())
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
      and (not public._is_staff_role(ra.role) or public._staff_mfa_ok())
  );
$$;

-- Switching the requirement on needs a super admin who has MFA themselves (aal2),
-- so the person enabling it cannot lock themselves out.
create or replace function public.set_staff_mfa_required(p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('super_admin') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_required is null then raise exception 'INVALID_INPUT'; end if;
  if p_required and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'MFA_REQUIRED_FIRST'; end if;
  update public.security_settings
  set require_staff_mfa = p_required, updated_by = auth.uid(), updated_at = now();
end $$;

-- Which active staff members have a verified second factor (for the rollout).
create or replace function public.staff_mfa_status()
returns table (user_id uuid, full_name text, email text, roles public.app_role[], has_mfa boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_role('super_admin') then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
    select up.id, up.full_name, up.email, array_agg(ra.role order by ra.role),
           exists (select 1 from auth.mfa_factors f where f.user_id = up.id and f.status::text = 'verified')
    from public.user_profiles up
    join public.role_assignments ra on ra.user_id = up.id and ra.revoked_at is null
    where up.is_active and public._is_staff_role(ra.role)
    group by up.id, up.full_name, up.email
    order by up.full_name;
end $$;

create trigger security_settings_audit after insert or update or delete on public.security_settings
  for each row execute function public.audit_row_change();

alter table public.security_settings enable row level security;
revoke all on public.security_settings from anon;
revoke insert, update, delete on public.security_settings from authenticated;
-- Signed-in users may read the policy (the console uses it to ask for a code).
create policy "security settings: signed-in read" on public.security_settings for select to authenticated using (true);

-- ---------- Export rate limit -------------------------------------------------------------
-- Wraps the Stage 9 export: at most 120 report runs per user per hour.
alter function public.export_report(text, jsonb) rename to _export_report;
revoke execute on function public._export_report(text, jsonb) from public, anon, authenticated;

create or replace function public.export_report(p_report text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.check_rate_limit('export:' || auth.uid(), 120, interval '1 hour') then
    raise exception 'RATE_LIMITED';
  end if;
  return public._export_report(p_report, p_params);
end $$;
revoke execute on function public.export_report(text, jsonb) from public, anon;
grant execute on function public.export_report(text, jsonb) to authenticated;

-- ---------- Backup / restore drill ----------------------------------------------------------
-- Each row is one consistency rule; `problems` must be 0 on a healthy database.
-- Run after every restore (and any time) with: select * from public.integrity_report();
create or replace function public.integrity_report()
returns table (check_name text, problems int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- anon cannot execute this; a null user here is the database owner (SQL editor) or the service role.
  if auth.uid() is not null and not public.has_role('super_admin') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
  select 'no_active_super_admin', (not exists (
      select 1 from public.role_assignments ra join public.user_profiles up on up.id = ra.user_id
      where ra.role = 'super_admin' and ra.revoked_at is null and up.is_active))::int
  union all
  select 'payments_over_allocated', count(*)::int from public.payments p
    where (select coalesce(sum(a.amount), 0) from public.payment_allocations a where a.payment_id = p.id) > p.amount
  union all
  select 'invoices_paid_more_than_total', count(*)::int from public.student_invoices i
    where i.status = 'issued' and public._invoice_paid(i.id) > public._invoice_total(i.id)
  union all
  select 'payments_on_cancelled_invoices', count(*)::int from public.payment_allocations a
    join public.payments p on p.id = a.payment_id and p.status = 'posted'
    join public.student_invoices i on i.id = a.invoice_id and i.status = 'cancelled'
  union all
  select 'students_without_enrollment', count(*)::int from public.students s
    where not exists (select 1 from public.student_enrollments e where e.student_id = s.id)
  union all
  select 'admitted_applications_without_student', count(*)::int from public.admission_applications a
    where a.status = 'admitted' and not exists (select 1 from public.students s where s.application_id = a.id)
  union all
  select 'marks_above_full_marks', count(*)::int from public.student_marks m
    join public.examination_subjects es on es.id = m.examination_subject_id
    where m.marks > es.full_marks
  union all
  select 'attendance_for_students_not_on_roll', count(*)::int from public.attendance_records r
    join public.attendance_sessions s on s.id = r.session_id
    where not public._on_roster(r.student_id, s.section_id, s.date)
  union all
  select 'student_document_files_missing', count(*)::int from public.student_documents d
    where not exists (select 1 from storage.objects o where o.bucket_id = d.bucket and o.name = d.storage_path)
  union all
  select 'application_document_files_missing', count(*)::int from public.application_documents d
    where not exists (select 1 from storage.objects o where o.bucket_id = 'admission-documents' and o.name = d.storage_path)
  union all
  select 'learning_resource_files_missing', count(*)::int from public.learning_resources r
    where r.file_path is not null
      and not exists (select 1 from storage.objects o where o.bucket_id = 'learning-resources' and o.name = r.file_path);
end $$;

-- Counts and totals to compare before a backup and after a restore.
create or replace function public.data_fingerprint()
returns table (item text, value numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is not null and not public.has_role('super_admin') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
  select 'students', (select count(*) from public.students)::numeric
  union all select 'guardians', (select count(*) from public.guardians)::numeric
  union all select 'enrollments', (select count(*) from public.student_enrollments)::numeric
  union all select 'admission_applications', (select count(*) from public.admission_applications)::numeric
  union all select 'attendance_records', (select count(*) from public.attendance_records)::numeric
  union all select 'student_marks', (select count(*) from public.student_marks)::numeric
  union all select 'invoices', (select count(*) from public.student_invoices)::numeric
  union all select 'payments', (select count(*) from public.payments)::numeric
  union all select 'posted_payment_total', (select coalesce(sum(amount), 0) from public.payments where status = 'posted')
  union all select 'audit_log_entries', (select count(*) from public.audit_logs)::numeric
  union all select 'stored_files', (select count(*) from storage.objects)::numeric;
end $$;

revoke execute on function public.integrity_report() from public, anon;
revoke execute on function public.data_fingerprint() from public, anon;
revoke execute on function public.staff_mfa_status() from public, anon;
revoke execute on function public.set_staff_mfa_required(boolean) from public, anon;
grant execute on function public.integrity_report() to authenticated, service_role;
grant execute on function public.data_fingerprint() to authenticated, service_role;
grant execute on function public.staff_mfa_status() to authenticated;
grant execute on function public.set_staff_mfa_required(boolean) to authenticated;
revoke execute on function public._staff_mfa_ok() from public, anon;
grant execute on function public._staff_mfa_ok() to authenticated;

-- ---------- Tighter grants ------------------------------------------------------------------
-- RLS already denies these to anonymous visitors; the table rights themselves are removed too.
revoke insert, update, delete on public.admission_settings, public.institution_settings, public.role_assignments from anon;

-- TRUNCATE ignores row-level security. The API never offers it, but no client role keeps it.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke truncate on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;

-- Internal helpers and staff-only workflow functions are not callable without signing in.
revoke execute on function public._payment_student(uuid) from public, anon;
revoke execute on function public._session_section(uuid) from public, anon;
revoke execute on function public._session_has_own_child(uuid) from public, anon;
revoke execute on function public._teaches_folder(text) from public, anon;
revoke execute on function public._mark_exam_status(uuid) from public, anon;
revoke execute on function public._exam_visible(public.exam_status) from public, anon;
revoke execute on function public.has_section_member(uuid) from public, anon;
revoke execute on function public.change_application_status(uuid, public.application_status, text) from public, anon;
revoke execute on function public.update_application_internal_notes(uuid, text) from public, anon;
