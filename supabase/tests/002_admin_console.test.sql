-- pgTAP tests for Stage 2 (admin console). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher@test.local');

insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher');

select is(
  (select email from user_profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'teacher@test.local', 'profile email is copied from auth.users');

update auth.users set email = 'teacher2@test.local' where id = '00000000-0000-0000-0000-0000000000b1';
select is(
  (select email from user_profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'teacher2@test.local', 'profile email follows auth email changes');

-- Teacher: sees only own profile, cannot edit email or another profile.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from user_profiles), 1, 'teacher sees only their own profile');
select throws_ok(
  $$update user_profiles set email = 'x@evil.test' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  '42501', null, 'users cannot change the mirrored email column');
select lives_ok(
  $$update user_profiles set full_name = 'Teacher One' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  'users can update their own name');
update user_profiles set full_name = 'Hacked' where id = '00000000-0000-0000-0000-0000000000a2';
reset role;
select is(
  (select full_name from user_profiles where id = '00000000-0000-0000-0000-0000000000a2'), '',
  'users cannot update another user''s profile');

-- School admin: reads all profiles; cannot deactivate a super admin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from user_profiles), 3, 'school admin sees all profiles');
select throws_ok(
  $$select set_user_active('00000000-0000-0000-0000-0000000000a1', false)$$,
  '42501', null, 'school admin cannot deactivate a super admin');
reset role;

-- Content management by a school admin; author and audit stamped server-side.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$insert into notices (id, title_en, body_en, status, author_id)
    values ('00000000-0000-0000-0000-00000000f001', 'Exam routine', 'x', 'draft', '00000000-0000-0000-0000-0000000000b1')$$,
  'school admin can create a notice');
select throws_ok(
  $$insert into role_assignments (user_id, role) values ('00000000-0000-0000-0000-0000000000b1', 'principal')$$,
  '42501', null, 'school admin cannot grant roles');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('public-assets', 'gallery/photo.jpg')$$,
  'school admin can upload to an approved public folder');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('public-assets', 'students/record.pdf')$$,
  '42501', null, 'uploads outside approved public folders are rejected');
reset role;
select is(
  (select author_id from notices where id = '00000000-0000-0000-0000-00000000f001'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'notice author is the acting user, not the client-supplied value');

-- Teacher cannot edit content or upload.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
update notices set title_en = 'Hacked' where id = '00000000-0000-0000-0000-00000000f001';
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('public-assets', 'gallery/x.jpg')$$,
  '42501', null, 'teacher cannot upload public files');
reset role;
select is((select title_en from notices where id = '00000000-0000-0000-0000-00000000f001'), 'Exam routine', 'teacher cannot edit notices');

-- Super admin revokes the teacher role; revocation is stamped and final.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update role_assignments set revoked_at = now()
  where user_id = '00000000-0000-0000-0000-0000000000b1' and role = 'teacher';
select throws_ok(
  $$update role_assignments set revoked_at = now() where user_id = '00000000-0000-0000-0000-0000000000b1' and role = 'teacher'$$,
  'P0001', null, 'a revoked role assignment cannot be changed again');
reset role;
select is(
  (select revoked_by from role_assignments where user_id = '00000000-0000-0000-0000-0000000000b1' and role = 'teacher'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'revocation records the acting super admin');
select is(
  (select count(*)::int from audit_logs
    where table_name = 'role_assignments' and action = 'update'
      and actor_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'role revocation is written to the audit log with the actor');

-- Deactivated users lose role-based access immediately.
update user_profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from user_profiles), 1, 'deactivated admin loses admin visibility');
reset role;

select * from finish();
rollback;
