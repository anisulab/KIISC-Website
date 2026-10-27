-- Harness-only security lint over the whole schema after all migrations.
-- A new table, function or bucket that breaks one of these rules fails the build.
begin;
select plan(9);

select is(
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null, 'every table has row-level security enabled');

select is(
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  null, 'every SECURITY DEFINER function pins its search_path');

-- Anonymous visitors may call only these privileged functions: public lookups, role
-- checks (false for visitors) and trigger functions (which cannot be called directly).
select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (
       'get_public_faculty', 'lookup_admission_status', 'is_working_day',
       'has_role', 'has_any_role', 'is_content_manager', 'is_academic_admin', 'is_admission_staff',
       'can_view_admissions', 'can_view_students', 'can_manage_students', 'can_view_attendance', 'can_manage_teaching',
       'can_manage_exams', 'can_approve_results', 'can_view_finance', 'can_manage_finance', 'can_manage_notifications',
       'can_access_resource', 'is_guardian_of', 'is_student_self', 'my_teacher_id', 'teaches_section', 'teaches_subject',
       'assign_staff_code', 'audit_row_change', 'handle_new_user', 'stamp_link_request', 'sync_user_email'
     )),
  null, 'anonymous visitors can call only allow-listed privileged functions');

select is(
  (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('claim_notifications', 'complete_notification', 'check_rate_limit')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  null, 'server-only functions are callable only by the service role');

select is(
  (select string_agg(c.relname || ':' || priv, ', ' order by c.relname) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') and has_table_privilege('anon', c.oid, priv)),
  null, 'anonymous visitors hold no write rights on any table');

select is(
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
  null, 'signed-in users cannot truncate any table');

select is(
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname <> 'finance_students'
     and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  null, 'views run with the caller''s rights (finance_students is the one reviewed exception)');

select is(
  (select string_agg(id, ', ' order by id) from storage.buckets where public),
  'public-assets', 'only the public-assets bucket is public');

select is(
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('audit_logs', 'payments', 'student_marks', 'payment_allocations', 'student_invoices', 'student_enrollments')
     and has_table_privilege('authenticated', c.oid, 'DELETE')),
  null, 'audit, financial, marks and enrollment history cannot be deleted through the API');

select * from finish();
rollback;
