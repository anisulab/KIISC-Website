-- pgTAP tests for Stage 7 (fees & finance). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(39);

-- ---------- Fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'parent1@test.local');
insert into role_assignments (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'school_admin'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts_officer'),
  ('00000000-0000-0000-0000-0000000000e1', 'principal'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher'),
  ('00000000-0000-0000-0000-0000000000f1', 'guardian');

insert into academic_years (id, code, name_en, starts_on, ends_on)
  values ('10000000-0000-0000-0000-000000000026', '2026', 'AY 2026', school_today() - 200, school_today() + 100);
insert into classes (id, code, name_en, level) values ('20000000-0000-0000-0000-000000000006', 'class-6', 'Class 6', 6);
insert into class_streams (class_id, medium) values ('20000000-0000-0000-0000-000000000006', 'bangla_medium');

create temporary table fx (name text primary key, id uuid);
grant select on fx to anon, authenticated;
insert into fx
select n, _create_student('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
         null, null, n, null, '2014-01-01', 'male', school_today() - 200, null, 'Dhaka 1236', 'Dhaka 1236', null,
         n || ' Parent', 'Father', phone, null, true)
from (values ('s1', '01710000001'), ('s2', '01710000002')) as v(n, phone);
update guardians set user_id = '00000000-0000-0000-0000-0000000000f1' where phone = '01710000001';

-- ---------- Fee setup (accounts officer) ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}';
insert into fee_categories (id, code, name_en) values
  ('c0000000-0000-0000-0000-000000000001', 'tuition', 'Monthly tuition'),
  ('c0000000-0000-0000-0000-000000000002', 'admission', 'Admission fee');
insert into fee_structures (id, academic_year_id, class_id, medium, fee_category_id, amount, frequency, late_fee_amount) values
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', null,
   'c0000000-0000-0000-0000-000000000001', 1500, 'monthly', 100),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium',
   'c0000000-0000-0000-0000-000000000002', 5000, 'one_time', 0);
insert into student_discounts (student_id, academic_year_id, fee_category_id, kind, value, reason)
  values ((select id from fx where name = 's2'), '10000000-0000-0000-0000-000000000026', 'c0000000-0000-0000-0000-000000000001', 'percent', 50, 'Sibling discount');
select is(
  (select approved_by from student_discounts), '00000000-0000-0000-0000-0000000000ac'::uuid,
  'discounts record who approved them');

select is(
  (generate_invoices('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', null,
     array['d0000000-0000-0000-0000-000000000001']::uuid[], '2026-01', school_today() - 30, school_today() - 20, 'Tuition January') ->> 'created')::int,
  2, 'invoices are generated for every enrolled student');
select is(
  (generate_invoices('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', null,
     array['d0000000-0000-0000-0000-000000000001']::uuid[], '2026-01', school_today() - 30, school_today() - 20, 'Tuition January') ->> 'created')::int,
  0, 'generating again for the same period does not bill twice');
select is(
  (select array_agg(invoice_no order by invoice_no) from student_invoices),
  array['KI-INV-2026-000001', 'KI-INV-2026-000002'], 'invoice numbers are generated sequentially');
select is(
  (select balance from invoice_summaries where student_id = (select id from fx where name = 's1')), 1500.00::numeric,
  'invoice balance is calculated');
select is(
  (select total from invoice_summaries where student_id = (select id from fx where name = 's2')), 750.00::numeric,
  'the 50% discount is applied when billing');
select throws_ok(
  $$select generate_invoices('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', null,
     array[gen_random_uuid()], '2026-02', school_today(), school_today(), 'X')$$,
  'P0001', 'INVALID_STRUCTURE', 'unknown fee structures are rejected');

-- ---------- Payments ----------
select is(
  (record_payment((select id from fx where name = 's1'), 1000, 'cash', null, school_today(), null,
     '11111111-1111-1111-1111-111111111111') ->> 'receipt_no'),
  'KI-RCT-' || extract(year from school_today())::int || '-000001', 'a cash payment gets a receipt number');
select is(
  (record_payment((select id from fx where name = 's1'), 1000, 'cash', null, school_today(), null,
     '11111111-1111-1111-1111-111111111111') ->> 'duplicate'),
  'true', 'submitting the same payment twice returns the original receipt');
select is((select count(*)::int from payments), 1, 'a double submission does not create a second payment');
select is(
  (select balance from invoice_summaries where student_id = (select id from fx where name = 's1')), 500.00::numeric,
  'the payment reduces the balance');
select throws_ok(
  $$select record_payment((select id from fx where name = 's1'), 500, 'mfs', '  ', school_today())$$,
  'P0001', 'REFERENCE_REQUIRED', 'mobile banking payments need a transaction ID');
select lives_ok(
  $$select record_payment((select id from fx where name = 's1'), 500, 'mfs', 'TRX9A1', school_today())$$,
  'a bKash/Nagad payment with a transaction ID is recorded');
select throws_ok(
  $$select record_payment((select id from fx where name = 's2'), 100, 'mfs', 'trx9a1', school_today())$$,
  'P0001', 'DUPLICATE_REFERENCE', 'the same transaction ID cannot be used twice');
select throws_ok(
  $$select record_payment((select id from fx where name = 's1'), 1, 'cash', null, school_today())$$,
  'P0001', 'OVERPAYMENT', 'payments larger than the outstanding balance are rejected');
select throws_ok(
  $$select record_payment((select id from fx where name = 's2'), 10.555, 'cash', null, school_today())$$,
  'P0001', 'INVALID_AMOUNT', 'amounts with more than two decimals are rejected');
select throws_ok(
  $$select record_payment((select id from fx where name = 's2'), 10, 'cash', null, school_today() + 1)$$,
  'P0001', 'INVALID_DATE', 'future payment dates are rejected');
select is(
  (select balance from invoice_summaries where student_id = (select id from fx where name = 's1')), 0.00::numeric,
  'the invoice is fully paid');
select throws_ok(
  $$insert into payments (receipt_no, student_id, amount, method, paid_on) values ('X', (select id from fx where name = 's1'), 10, 'cash', school_today())$$,
  '42501', null, 'payments cannot be written directly');
select throws_ok(
  $$delete from payments$$, '42501', null, 'payments can never be deleted');

-- ---------- Corrections keep history ----------
select throws_ok(
  $$select reverse_payment((select id from payments where reference = 'TRX9A1'), '')$$,
  'P0001', 'REASON_REQUIRED', 'a reversal needs a reason');
select lives_ok(
  $$select reverse_payment((select id from payments where reference = 'TRX9A1'), 'Customer used the wrong account')$$,
  'a payment can be reversed with a reason');
select is(
  (select balance from invoice_summaries where student_id = (select id from fx where name = 's1')), 500.00::numeric,
  'a reversed payment no longer counts towards the balance');
select is((select count(*)::int from payments), 2, 'the reversed payment is kept as history');
select throws_ok(
  $$select reverse_payment((select id from payments where reference = 'TRX9A1'), 'again')$$,
  'P0001', 'ALREADY_REVERSED', 'a payment cannot be reversed twice');
select throws_ok(
  $$select cancel_invoice((select id from student_invoices where student_id = (select id from fx where name = 's1')), 'Wrong amount')$$,
  'P0001', 'INVOICE_HAS_PAYMENTS', 'an invoice with payments cannot be cancelled');
select throws_ok(
  $$select add_invoice_adjustment((select id from student_invoices where student_id = (select id from fx where name = 's1')), -600, 'Waiver')$$,
  'P0001', 'BELOW_PAID', 'an adjustment cannot reduce the total below what has been paid');
select lives_ok(
  $$select cancel_invoice((select id from student_invoices where student_id = (select id from fx where name = 's2')), 'Billed in error')$$,
  'an unpaid invoice can be cancelled with a reason');
select is(
  (generate_invoices('10000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000006', 'bangla_medium', null,
     array['d0000000-0000-0000-0000-000000000001']::uuid[], '2026-01', school_today() - 30, school_today() - 20, 'Tuition January') ->> 'created')::int,
  1, 'a cancelled invoice can be re-issued');
select is(apply_late_fees(), 2, 'late fees are added to overdue unpaid invoices');
select is(apply_late_fees(), 0, 'late fees are added only once');
reset role;

-- ---------- Who sees what ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select record_payment((select id from fx where name = 's1'), 100, 'cash', null, school_today())$$,
  '42501', null, 'school administrators cannot record payments');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from invoice_summaries), 0, 'teachers cannot see invoices');
select is((select count(*)::int from finance_students), 0, 'teachers cannot use the finance student directory');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ac","role":"authenticated"}';
select is((select count(*)::int from finance_students), 2, 'accounts staff can look up students for billing');
select is((select count(*)::int from students), 0, 'accounts staff do not get full student records');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select is(
  (select count(*)::int from invoice_summaries), 1, 'a guardian sees only their child''s invoices');
select is(
  (select balance from invoice_summaries), 600.00::numeric, 'a guardian sees the correct balance including the late fee');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is(
  (select sum(amount) from finance_collections(school_today() - 1, school_today())), 1000.00::numeric,
  'the collection report counts only posted payments');
reset role;

select * from finish();
rollback;
