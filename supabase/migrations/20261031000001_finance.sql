-- =====================================================================
-- Stage 7: fees, invoices, payments, receipts, discounts, adjustments.
-- Financial records are never deleted: corrections are reversals,
-- cancellations (only when nothing is paid) or adjustment items, and all
-- money arithmetic happens in the database.
-- =====================================================================

create type public.fee_frequency as enum ('one_time', 'monthly', 'per_term', 'per_exam', 'yearly');
create type public.payment_method as enum ('cash', 'bank', 'mfs', 'other');
create type public.invoice_status as enum ('issued', 'cancelled');
create type public.payment_status as enum ('posted', 'reversed');
create type public.invoice_item_kind as enum ('charge', 'discount', 'late_fee', 'adjustment');
create type public.discount_kind as enum ('percent', 'fixed');

create or replace function public.can_manage_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'accounts_officer']::public.app_role[]);
$$;

create or replace function public.can_view_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'accounts_officer', 'principal', 'school_admin']::public.app_role[]);
$$;

-- ---------- Fee setup ------------------------------------------------------------
create table public.fee_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{1,40}$'),
  name_en text not null check (char_length(name_en) between 2 and 100),
  name_bn text check (char_length(name_bn) <= 100),
  description_en text,
  description_bn text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id),
  class_id uuid not null references public.classes (id),
  medium public.education_medium,                  -- NULL = same for both streams
  fee_category_id uuid not null references public.fee_categories (id),
  amount numeric(12, 2) not null check (amount > 0),
  frequency public.fee_frequency not null default 'one_time',
  due_date date,
  late_fee_amount numeric(12, 2) not null default 0 check (late_fee_amount >= 0),
  late_fee_after_days int check (late_fee_after_days is null or late_fee_after_days >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One amount per year/class/stream/category ("both streams" = NULL counts as a value).
  constraint fee_structures_unique unique nulls not distinct (academic_year_id, class_id, medium, fee_category_id)
);

create table public.student_discounts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  academic_year_id uuid not null references public.academic_years (id),
  fee_category_id uuid references public.fee_categories (id),   -- NULL = all categories
  kind public.discount_kind not null,
  value numeric(12, 2) not null check (value > 0),
  reason text not null check (char_length(reason) between 3 and 300),
  is_active boolean not null default true,
  approved_by uuid references auth.users (id),
  approved_at timestamptz not null default now(),
  constraint student_discounts_percent check (kind <> 'percent' or value <= 100)
);
create index student_discounts_student_idx on public.student_discounts (student_id, academic_year_id);

create or replace function public.stamp_discount()
returns trigger language plpgsql as $$
begin
  new.approved_by := auth.uid();
  new.approved_at := now();
  return new;
end $$;
create trigger student_discounts_stamp before insert on public.student_discounts
  for each row execute function public.stamp_discount();

-- ---------- Invoices ----------------------------------------------------------------
create table public.student_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  student_id uuid not null references public.students (id),
  academic_year_id uuid not null references public.academic_years (id),
  title_en text not null check (char_length(title_en) between 2 and 150),
  title_bn text check (char_length(title_bn) <= 150),
  period text check (period is null or period ~ '^[0-9]{4}(-[0-9]{2})?$'),
  issue_date date not null,
  due_date date not null,
  status public.invoice_status not null default 'issued',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references auth.users (id),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  constraint student_invoices_dates check (due_date >= issue_date)
);
create index student_invoices_student_idx on public.student_invoices (student_id, status);
create index student_invoices_year_idx on public.student_invoices (academic_year_id, due_date);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.student_invoices (id),
  student_id uuid not null references public.students (id),
  kind public.invoice_item_kind not null,
  fee_structure_id uuid references public.fee_structures (id),
  fee_category_id uuid references public.fee_categories (id),
  description_en text not null check (char_length(description_en) <= 200),
  description_bn text check (char_length(description_bn) <= 200),
  amount numeric(12, 2) not null check (amount <> 0),
  period text,
  reason text check (char_length(reason) <= 300),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  cancelled boolean not null default false,
  constraint invoice_items_sign check (
    (kind in ('charge', 'late_fee') and amount > 0) or (kind = 'discount' and amount < 0) or kind = 'adjustment'
  )
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
-- A student is never charged twice for the same fee and period.
create unique index invoice_items_no_double_charge
  on public.invoice_items (student_id, fee_structure_id, coalesce(period, ''))
  where kind = 'charge' and not cancelled and fee_structure_id is not null;
create unique index invoice_items_one_late_fee
  on public.invoice_items (invoice_id, fee_structure_id)
  where kind = 'late_fee' and not cancelled;

-- ---------- Payments ------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  student_id uuid not null references public.students (id),
  amount numeric(12, 2) not null check (amount > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 100),     -- bank / MFS transaction ID
  paid_on date not null,
  note text check (char_length(note) <= 300),
  idempotency_key uuid unique,                              -- one submission = one payment
  received_by uuid references auth.users (id),
  received_at timestamptz not null default now(),
  status public.payment_status not null default 'posted',
  reversed_by uuid references auth.users (id),
  reversed_at timestamptz,
  reversal_reason text check (char_length(reversal_reason) <= 300)
);
create index payments_student_idx on public.payments (student_id);
create index payments_paid_on_idx on public.payments (paid_on);
-- The same bank/MFS transaction cannot be recorded twice.
create unique index payments_reference_unique on public.payments (method, lower(reference))
  where reference is not null and status = 'posted';

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  invoice_id uuid not null references public.student_invoices (id),
  amount numeric(12, 2) not null check (amount > 0),
  unique (payment_id, invoice_id)
);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

-- ---------- Balances --------------------------------------------------------------------
create or replace function public._invoice_total(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.invoice_items where invoice_id = p_invoice and not cancelled;
$$;

create or replace function public._invoice_paid(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.amount), 0)
  from public.payment_allocations a join public.payments p on p.id = a.payment_id
  where a.invoice_id = p_invoice and p.status = 'posted';
$$;

-- Invoice list with totals; security_invoker so the caller's RLS applies.
create view public.invoice_summaries with (security_invoker = true) as
  select i.*, x.total, x.paid, x.total - x.paid as balance
  from public.student_invoices i
  cross join lateral (
    select
      coalesce((select sum(it.amount) from public.invoice_items it where it.invoice_id = i.id and not it.cancelled), 0) as total,
      coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                where a.invoice_id = i.id and p.status = 'posted'), 0) as paid
  ) x;

-- ---------- Operations ---------------------------------------------------------------------
create or replace function public._apply_discount(p_student uuid, p_year uuid, p_category uuid, p_amount numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select least(
    p_amount,
    coalesce(sum(case when d.kind = 'percent' then round(p_amount * d.value / 100, 2) else d.value end), 0)
  )
  from public.student_discounts d
  where d.student_id = p_student and d.academic_year_id = p_year and d.is_active
    and (d.fee_category_id is null or d.fee_category_id = p_category);
$$;

-- Bills every active, enrolled student of a class/stream (optionally a section)
-- for the chosen fee structures and period. Already-billed fees are skipped.
create or replace function public.generate_invoices(
  p_year uuid, p_class uuid, p_medium public.education_medium, p_section uuid,
  p_structures uuid[], p_period text, p_issue_date date, p_due_date date,
  p_title_en text, p_title_bn text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  y public.academic_years;
  st record;
  fs record;
  v_invoice uuid;
  v_discount numeric;
  v_created int := 0;
  v_skipped int := 0;
begin
  if not public.can_manage_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into y from public.academic_years where id = p_year;
  if not found then raise exception 'INVALID_YEAR'; end if;
  if coalesce(array_length(p_structures, 1), 0) = 0 then raise exception 'NO_FEES_SELECTED'; end if;
  if exists (
    select 1 from unnest(p_structures) sid
    where not exists (
      select 1 from public.fee_structures f
      where f.id = sid and f.is_active and f.academic_year_id = p_year and f.class_id = p_class
        and (f.medium is null or f.medium = p_medium)
    )
  ) then
    raise exception 'INVALID_STRUCTURE';
  end if;
  if nullif(trim(coalesce(p_title_en, '')), '') is null then raise exception 'MISSING_FIELD'; end if;
  if p_issue_date is null or p_due_date is null or p_due_date < p_issue_date then raise exception 'INVALID_DATE'; end if;
  if p_period is not null and p_period !~ '^[0-9]{4}(-[0-9]{2})?$' then raise exception 'INVALID_PERIOD'; end if;

  for st in
    select distinct s.id
    from public.students s
    join public.student_enrollments e on e.student_id = s.id
    where e.academic_year_id = p_year and e.class_id = p_class and e.medium = p_medium
      and e.status = 'enrolled' and s.status = 'active'
      and (p_section is null or e.section_id = p_section)
  loop
    v_invoice := null;
    for fs in
      select f.*, c.name_en as cat_en, c.name_bn as cat_bn
      from public.fee_structures f join public.fee_categories c on c.id = f.fee_category_id
      where f.id = any (p_structures)
        and not exists (
          select 1 from public.invoice_items it
          where it.student_id = st.id and it.fee_structure_id = f.id and it.kind = 'charge'
            and not it.cancelled and coalesce(it.period, '') = coalesce(p_period, '')
        )
      order by c.name_en
    loop
      if v_invoice is null then
        insert into public.student_invoices (invoice_no, student_id, academic_year_id, title_en, title_bn, period, issue_date, due_date, created_by)
        values (
          'KI-INV-' || left(y.code, 4) || '-' || public.pad_number(public.next_document_number('invoice:' || left(y.code, 4)), 6),
          st.id, p_year, trim(p_title_en), nullif(trim(coalesce(p_title_bn, '')), ''), p_period, p_issue_date, p_due_date, auth.uid()
        )
        returning id into v_invoice;
      end if;
      insert into public.invoice_items (invoice_id, student_id, kind, fee_structure_id, fee_category_id, description_en, description_bn, amount, period, created_by)
      values (v_invoice, st.id, 'charge', fs.id, fs.fee_category_id, fs.cat_en || coalesce(' (' || p_period || ')', ''),
              fs.cat_bn || coalesce(' (' || p_period || ')', ''), fs.amount, p_period, auth.uid());

      v_discount := public._apply_discount(st.id, p_year, fs.fee_category_id, fs.amount);
      if v_discount > 0 then
        insert into public.invoice_items (invoice_id, student_id, kind, fee_structure_id, fee_category_id, description_en, description_bn, amount, period, created_by)
        values (v_invoice, st.id, 'discount', fs.id, fs.fee_category_id, 'Discount: ' || fs.cat_en, 'ছাড়: ' || coalesce(fs.cat_bn, fs.cat_en), -v_discount, p_period, auth.uid());
      end if;
    end loop;
    if v_invoice is null then v_skipped := v_skipped + 1; else v_created := v_created + 1; end if;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

create or replace function public.record_payment(
  p_student uuid, p_amount numeric, p_method public.payment_method, p_reference text, p_paid_on date,
  p_invoice uuid default null, p_idempotency_key uuid default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing public.payments;
  v_ref text := nullif(trim(coalesce(p_reference, '')), '');
  v_outstanding numeric;
  v_id uuid := gen_random_uuid();
  v_receipt text;
  v_left numeric := p_amount;
  v_alloc numeric;
  inv record;
begin
  if not public.can_manage_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;

  -- Re-submitting the same form (double click, retry) returns the original receipt.
  if p_idempotency_key is not null then
    select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.student_id <> p_student or v_existing.amount <> p_amount then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return jsonb_build_object('payment_id', v_existing.id, 'receipt_no', v_existing.receipt_no, 'duplicate', true);
    end if;
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'INVALID_AMOUNT'; end if;
  if p_paid_on is null or p_paid_on > public.school_today() then raise exception 'INVALID_DATE'; end if;
  if p_method in ('bank', 'mfs') and v_ref is null then raise exception 'REFERENCE_REQUIRED'; end if;
  if v_ref is not null and exists (
    select 1 from public.payments where method = p_method and lower(reference) = lower(v_ref) and status = 'posted'
  ) then
    raise exception 'DUPLICATE_REFERENCE';
  end if;
  if p_invoice is not null and not exists (
    select 1 from public.student_invoices where id = p_invoice and student_id = p_student and status = 'issued'
  ) then
    raise exception 'INVALID_INVOICE';
  end if;

  -- Serialise payments per student so balances cannot be over-allocated concurrently.
  perform 1 from public.students where id = p_student for update;
  select coalesce(sum(b), 0) into v_outstanding from (
    select public._invoice_total(i.id) - public._invoice_paid(i.id) as b
    from public.student_invoices i
    where i.student_id = p_student and i.status = 'issued' and (p_invoice is null or i.id = p_invoice)
  ) x where b > 0;
  if p_amount > v_outstanding then raise exception 'OVERPAYMENT'; end if;

  v_receipt := 'KI-RCT-' || extract(year from p_paid_on)::int || '-'
               || public.pad_number(public.next_document_number('receipt:' || extract(year from p_paid_on)::int), 6);
  insert into public.payments (id, receipt_no, student_id, amount, method, reference, paid_on, note, idempotency_key, received_by)
  values (v_id, v_receipt, p_student, p_amount, p_method, v_ref, p_paid_on, left(nullif(trim(coalesce(p_note, '')), ''), 300), p_idempotency_key, auth.uid());

  -- Oldest due invoices are settled first.
  for inv in
    select i.id, public._invoice_total(i.id) - public._invoice_paid(i.id) as balance
    from public.student_invoices i
    where i.student_id = p_student and i.status = 'issued' and (p_invoice is null or i.id = p_invoice)
    order by i.due_date, i.issue_date, i.invoice_no
  loop
    exit when v_left <= 0;
    continue when inv.balance <= 0;
    v_alloc := least(v_left, inv.balance);
    insert into public.payment_allocations (payment_id, invoice_id, amount) values (v_id, inv.id, v_alloc);
    v_left := v_left - v_alloc;
  end loop;

  return jsonb_build_object('payment_id', v_id, 'receipt_no', v_receipt, 'duplicate', false);
end $$;

-- A mistaken payment is reversed (kept for history), never deleted.
create or replace function public.reverse_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if not public.can_manage_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.status = 'reversed' then raise exception 'ALREADY_REVERSED'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  update public.payments
  set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = left(trim(p_reason), 300)
  where id = p_payment;
end $$;

create or replace function public.cancel_invoice(p_invoice uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.student_invoices;
begin
  if not public.can_manage_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into i from public.student_invoices where id = p_invoice for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if i.status = 'cancelled' then raise exception 'ALREADY_CANCELLED'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if public._invoice_paid(p_invoice) > 0 then raise exception 'INVOICE_HAS_PAYMENTS'; end if;
  update public.student_invoices
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = left(trim(p_reason), 300)
  where id = p_invoice;
  update public.invoice_items set cancelled = true where invoice_id = p_invoice;
end $$;

-- Adds a signed adjustment line (e.g. waiver or extra charge) with a reason.
create or replace function public.add_invoice_adjustment(p_invoice uuid, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.student_invoices;
  v_id uuid;
begin
  if not public.can_manage_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into i from public.student_invoices where id = p_invoice for update;
  if not found or i.status <> 'issued' then raise exception 'INVALID_INVOICE'; end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount, 2) then raise exception 'INVALID_AMOUNT'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED'; end if;
  if public._invoice_total(p_invoice) + p_amount < public._invoice_paid(p_invoice) then raise exception 'BELOW_PAID'; end if;
  insert into public.invoice_items (invoice_id, student_id, kind, description_en, description_bn, amount, reason, created_by)
  values (p_invoice, i.student_id, 'adjustment', 'Adjustment', 'সমন্বয়', p_amount, left(trim(p_reason), 300), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Adds each configured late fee once to overdue, unpaid invoices.
create or replace function public.apply_late_fees(p_as_of date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_as_of date := coalesce(p_as_of, public.school_today());
  n int;
begin
  if not public.can_manage_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  insert into public.invoice_items (invoice_id, student_id, kind, fee_structure_id, fee_category_id, description_en, description_bn, amount, period, created_by)
  select it.invoice_id, it.student_id, 'late_fee', f.id, f.fee_category_id,
         'Late fee: ' || c.name_en, 'বিলম্ব ফি: ' || coalesce(c.name_bn, c.name_en), f.late_fee_amount, it.period, auth.uid()
  from public.invoice_items it
  join public.student_invoices i on i.id = it.invoice_id and i.status = 'issued'
  join public.fee_structures f on f.id = it.fee_structure_id and f.late_fee_amount > 0
  join public.fee_categories c on c.id = f.fee_category_id
  where it.kind = 'charge' and not it.cancelled
    and i.due_date + coalesce(f.late_fee_after_days, 0) < v_as_of
    and public._invoice_total(i.id) - public._invoice_paid(i.id) > 0
    and not exists (
      select 1 from public.invoice_items lf
      where lf.invoice_id = it.invoice_id and lf.fee_structure_id = f.id and lf.kind = 'late_fee' and not lf.cancelled
    );
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Reports ------------------------------------------------------------------------
create or replace function public.finance_collections(p_from date, p_to date)
returns table (paid_on date, method public.payment_method, payments int, amount numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_view_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
    select p.paid_on, p.method, count(*)::int, sum(p.amount)
    from public.payments p
    where p.status = 'posted' and p.paid_on between p_from and p_to
    group by p.paid_on, p.method
    order by p.paid_on, p.method;
end $$;

create or replace function public.finance_outstanding(p_year uuid, p_class uuid default null)
returns table (
  student_id uuid, student_code text, name_en text, name_bn text,
  class_name_en text, class_name_bn text, section_name text,
  invoiced numeric, paid numeric, balance numeric, oldest_due date
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_view_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  return query
    with inv as (
      select i.student_id, i.due_date, public._invoice_total(i.id) as total, public._invoice_paid(i.id) as paid
      from public.student_invoices i
      where i.academic_year_id = p_year and i.status = 'issued'
    ),
    agg as (
      select inv.student_id, sum(inv.total) as invoiced, sum(inv.paid) as paid,
             min(inv.due_date) filter (where inv.total > inv.paid) as oldest_due
      from inv group by inv.student_id
    )
    select s.id, s.student_code, s.name_en, s.name_bn, c.name_en, c.name_bn, se.name,
           a.invoiced, a.paid, a.invoiced - a.paid, a.oldest_due
    from agg a
    join public.students s on s.id = a.student_id
    left join public.student_enrollments e on e.student_id = s.id and e.academic_year_id = p_year
    left join public.classes c on c.id = e.class_id
    left join public.sections se on se.id = e.section_id
    where a.invoiced > a.paid and (p_class is null or e.class_id = p_class)
    order by a.invoiced - a.paid desc, s.name_en;
end $$;

-- ---------- Triggers -----------------------------------------------------------------------
create trigger fee_structures_updated_at before update on public.fee_structures for each row execute function public.set_updated_at();
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'fee_categories', 'fee_structures', 'student_discounts', 'student_invoices', 'invoice_items', 'payments', 'payment_allocations'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', tbl || '_audit', tbl);
  end loop;
end $$;

-- ---------- Grants & RLS -------------------------------------------------------------------
revoke execute on function public._invoice_total(uuid) from public, anon, authenticated;
revoke execute on function public._invoice_paid(uuid) from public, anon, authenticated;
revoke execute on function public._apply_discount(uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.generate_invoices(uuid, uuid, public.education_medium, uuid, uuid[], text, date, date, text, text) from public, anon;
revoke execute on function public.record_payment(uuid, numeric, public.payment_method, text, date, uuid, uuid, text) from public, anon;
revoke execute on function public.reverse_payment(uuid, text) from public, anon;
revoke execute on function public.cancel_invoice(uuid, text) from public, anon;
revoke execute on function public.add_invoice_adjustment(uuid, numeric, text) from public, anon;
revoke execute on function public.apply_late_fees(date) from public, anon;
revoke execute on function public.finance_collections(date, date) from public, anon;
revoke execute on function public.finance_outstanding(uuid, uuid) from public, anon;
grant execute on function public.generate_invoices(uuid, uuid, public.education_medium, uuid, uuid[], text, date, date, text, text) to authenticated;
grant execute on function public.record_payment(uuid, numeric, public.payment_method, text, date, uuid, uuid, text) to authenticated;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
grant execute on function public.add_invoice_adjustment(uuid, numeric, text) to authenticated;
grant execute on function public.apply_late_fees(date) to authenticated;
grant execute on function public.finance_collections(date, date) to authenticated;
grant execute on function public.finance_outstanding(uuid, uuid) to authenticated;

alter table public.fee_categories enable row level security;
alter table public.fee_structures enable row level security;
alter table public.student_discounts enable row level security;
alter table public.student_invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;

revoke all on public.fee_categories, public.fee_structures, public.student_discounts, public.student_invoices,
  public.invoice_items, public.payments, public.payment_allocations, public.invoice_summaries from anon;

-- Fee schedules are general information for signed-in users; only accounts staff change them.
create policy "fee categories: signed-in read" on public.fee_categories for select to authenticated using (true);
create policy "fee categories: finance write" on public.fee_categories for all to authenticated
  using (public.can_manage_finance()) with check (public.can_manage_finance());
create policy "fee structures: signed-in read" on public.fee_structures for select to authenticated using (true);
create policy "fee structures: finance write" on public.fee_structures for all to authenticated
  using (public.can_manage_finance()) with check (public.can_manage_finance());

create policy "discounts: finance read" on public.student_discounts for select to authenticated using (public.can_view_finance());
create policy "discounts: finance insert" on public.student_discounts for insert to authenticated with check (public.can_manage_finance());
create policy "discounts: finance update" on public.student_discounts for update to authenticated
  using (public.can_manage_finance()) with check (public.can_manage_finance());
revoke delete on public.student_discounts from authenticated;   -- deactivate instead

create policy "invoices: finance or own child" on public.student_invoices for select to authenticated
  using (public.can_view_finance() or public.is_guardian_of(student_id) or public.is_student_self(student_id));
create policy "invoice items: finance or own child" on public.invoice_items for select to authenticated
  using (public.can_view_finance() or public.is_guardian_of(student_id) or public.is_student_self(student_id));
create policy "payments: finance or own child" on public.payments for select to authenticated
  using (public.can_view_finance() or public.is_guardian_of(student_id) or public.is_student_self(student_id));

create or replace function public._payment_student(p_payment uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select student_id from public.payments where id = p_payment;
$$;
create policy "allocations: finance or own child" on public.payment_allocations for select to authenticated
  using (
    public.can_view_finance()
    or public.is_guardian_of(public._payment_student(payment_id))
    or public.is_student_self(public._payment_student(payment_id))
  );

-- Minimal student directory for finance staff (no addresses, guardians or notes).
-- Deliberately runs with the view owner's rights; the WHERE clause limits it to finance roles.
create view public.finance_students as
  select s.id, s.student_code, s.name_en, s.name_bn, s.medium, s.status,
         c.name_en as class_name_en, c.name_bn as class_name_bn, se.name as section_name
  from public.students s
  left join lateral (
    select e.class_id, e.section_id from public.student_enrollments e
    where e.student_id = s.id order by e.start_date desc nulls last, e.created_at desc limit 1
  ) e on true
  left join public.classes c on c.id = e.class_id
  left join public.sections se on se.id = e.section_id
  where public.can_view_finance();
revoke all on public.finance_students from anon;
grant select on public.finance_students to authenticated;

-- All money movements go through the functions above; nothing is deleted.
revoke insert, update, delete on public.student_invoices, public.invoice_items, public.payments, public.payment_allocations from authenticated;
grant select on public.invoice_summaries to authenticated;
