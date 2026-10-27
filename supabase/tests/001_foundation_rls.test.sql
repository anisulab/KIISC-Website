-- pgTAP tests for the Stage 1 foundation. Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

-- ---------- Fixtures (run as the migration owner, bypassing RLS) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'parent@test.local');

select is((select count(*)::int from user_profiles), 4, 'profiles are created for new auth users');

insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000c1', 'guardian');

insert into notices (title_en, body_en, status, publish_at, expires_at) values
  ('Draft notice', 'x', 'draft', now() - interval '1 day', null),
  ('Published notice', 'y', 'published', now() - interval '1 day', null),
  ('Future notice', 'z', 'published', now() + interval '1 day', null),
  ('Expired notice', 'w', 'published', now() - interval '3 days', now() - interval '1 day');

-- ---------- Anonymous visitor ----------
set local role anon;
select is((select count(*)::int from notices), 1, 'anon sees only published, current notices');
select is((select count(*)::int from institution_settings), 1, 'anon can read institution settings');
select is((select count(*)::int from audit_logs), 0, 'anon cannot read audit logs');
select is((select count(*)::int from role_assignments), 0, 'anon cannot read role assignments');
select throws_ok(
  $$insert into notices (title_en, body_en) values ('hack', 'x')$$,
  '42501', null, 'anon cannot create notices');
reset role;

-- ---------- Teacher ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from notices), 1, 'teacher sees only published notices');
select is((select count(*)::int from role_assignments), 1, 'teacher sees only own role assignment');
select throws_ok(
  $$insert into role_assignments (user_id, role) values ('00000000-0000-0000-0000-0000000000b1', 'super_admin')$$,
  '42501', null, 'teacher cannot grant themselves a role');
select throws_ok(
  $$update user_profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000c1'$$,
  '42501', null, 'teacher cannot change account status columns');
select throws_ok(
  $$select set_user_active('00000000-0000-0000-0000-0000000000c1', false)$$,
  '42501', null, 'teacher cannot deactivate accounts');
select is((select count(*)::int from audit_logs), 0, 'teacher cannot read audit logs');
reset role;

-- ---------- School administrator ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from notices), 4, 'school admin sees drafts and scheduled notices');
select throws_ok(
  $$insert into role_assignments (user_id, role) values ('00000000-0000-0000-0000-0000000000a2', 'super_admin')$$,
  '42501', null, 'school admin cannot escalate to super admin');
-- RLS filters the row out of the UPDATE (0 rows affected) rather than raising.
update institution_settings set phone = '0000000000';
reset role;
select is((select phone from institution_settings), '01301461643', 'school admin cannot change institution settings');

-- ---------- Super administrator ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$insert into role_assignments (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'teacher')$$,
  '42501', null, 'super admin cannot change their own roles');
select lives_ok(
  $$insert into role_assignments (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'student')$$,
  'super admin can grant a role to another user');
reset role;

select * from finish();
rollback;
