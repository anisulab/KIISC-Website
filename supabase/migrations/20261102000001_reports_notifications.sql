-- =====================================================================
-- Stage 9: report exports and email notifications.
-- Exports run on the server with the same permission checks as the
-- on-screen reports, and every export is written to the audit log.
-- Emails are queued in an outbox by database triggers and sent by the
-- `send-notifications` edge function; every event is OFF until the school
-- turns it on, and nothing is sent until an email provider is configured.
-- =====================================================================

-- ---------- Report exports ------------------------------------------------------------
create or replace function public._report_range(p jsonb, out v_from date, out v_to date)
language plpgsql immutable as $$
begin
  v_from := (p ->> 'from')::date;
  v_to := (p ->> 'to')::date;
  if v_from is null or v_to is null or v_from > v_to or v_to - v_from > 366 then
    raise exception 'INVALID_RANGE';
  end if;
end $$;

-- Returns { rows: [...] } (plus `subjects` for exam results). Each report applies the
-- permission check of its on-screen equivalent; the export itself is audited.
create or replace function public.export_report(p_report text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p jsonb := coalesce(p_params, '{}'::jsonb);
  v_rows jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_from date;
  v_to date;
  v_section uuid;
  v_exam uuid;
begin
  case p_report
    when 'students' then
      if not public.can_view_students() then raise exception 'Not authorised' using errcode = '42501'; end if;
      if p ->> 'year' is null then raise exception 'INVALID_PARAMS'; end if;
      select coalesce(jsonb_agg(to_jsonb(x) - '_level' order by x._level, x.medium, x.section_name, x.roll_no nulls last, x.name_en), '[]'::jsonb)
      into v_rows
      from (
        select s.student_code, s.admission_no, s.name_en, s.name_bn, s.gender, s.date_of_birth, s.medium,
               c.name_en as class_name_en, c.name_bn as class_name_bn, se.name as section_name, e.roll_no,
               e.status as enrollment_status, s.status, g.name as guardian_name, g.relationship as guardian_relationship,
               g.phone as guardian_phone, g.email as guardian_email, c.level as _level
        from public.student_enrollments e
        join public.students s on s.id = e.student_id
        join public.classes c on c.id = e.class_id
        left join public.sections se on se.id = e.section_id
        left join lateral (
          select gd.name, gd.phone, gd.email, sg.relationship
          from public.student_guardians sg join public.guardians gd on gd.id = sg.guardian_id
          where sg.student_id = s.id
          order by sg.is_primary desc, sg.created_at limit 1
        ) g on true
        where e.academic_year_id = (p ->> 'year')::uuid
          and (p ->> 'class' is null or e.class_id = (p ->> 'class')::uuid)
          and (p ->> 'medium' is null or e.medium = (p ->> 'medium')::public.education_medium)
          and (p ->> 'section' is null or e.section_id = (p ->> 'section')::uuid)
          and (p ->> 'status' is null or s.status = (p ->> 'status')::public.student_status)
      ) x;

    when 'admissions' then
      if not public.can_view_admissions() then raise exception 'Not authorised' using errcode = '42501'; end if;
      if p ->> 'year' is null then raise exception 'INVALID_PARAMS'; end if;
      select coalesce(jsonb_agg(to_jsonb(x) - '_level' order by x.submitted_on, x.reference_no), '[]'::jsonb) into v_rows
      from (
        select a.reference_no, (a.submitted_at at time zone 'Asia/Dhaka')::date as submitted_on,
               a.student_name_en, a.student_name_bn, a.date_of_birth, a.gender,
               c.name_en as class_name_en, c.name_bn as class_name_bn, a.medium,
               a.guardian_name, a.guardian_relationship, a.guardian_phone, a.guardian_email, a.status, c.level as _level
        from public.admission_applications a
        join public.classes c on c.id = a.class_id
        where a.academic_year_id = (p ->> 'year')::uuid
          and (p ->> 'status' is null or a.status = (p ->> 'status')::public.application_status)
      ) x;

    when 'attendance_summary' then
      select r.v_from, r.v_to into v_from, v_to from public._report_range(p) r;
      v_section := (p ->> 'section')::uuid;
      if v_section is null then raise exception 'INVALID_PARAMS'; end if;
      -- attendance_section_summary checks staff / section-teacher access.
      select coalesce(jsonb_agg(to_jsonb(r) - 'student_id'), '[]'::jsonb) into v_rows
      from public.attendance_section_summary(v_section, v_from, v_to) r;

    when 'attendance_absences' then
      select r.v_from, r.v_to into v_from, v_to from public._report_range(p) r;
      select coalesce(jsonb_agg(to_jsonb(r) - 'student_id'), '[]'::jsonb) into v_rows
      from public.attendance_absence_report(v_from, v_to, coalesce((p ->> 'min_absences')::int, 1)) r;

    when 'exam_results' then
      v_exam := (p ->> 'exam')::uuid;
      v_section := (p ->> 'section')::uuid;
      if v_exam is null or v_section is null then raise exception 'INVALID_PARAMS'; end if;
      if not (public.can_manage_exams() or public.can_approve_results() or public.teaches_section(v_section)) then
        raise exception 'Not authorised' using errcode = '42501';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('id', x.subject_id, 'name_en', x.name_en, 'name_bn', x.name_bn)
               order by x.sort_order, x.name_en), '[]'::jsonb)
      into v_extra
      from (
        select distinct es.subject_id, es.sort_order, sj.name_en, sj.name_bn
        from public.examination_subjects es
        join public.sections se on se.id = v_section and es.class_id = se.class_id and es.medium = se.medium
        join public.subjects sj on sj.id = es.subject_id
        where es.examination_id = v_exam
      ) x;
      v_extra := jsonb_build_object('subjects', v_extra);
      with o as (select * from public._exam_subject_outcomes(v_exam, v_section)),
      m as (
        select o.student_id, jsonb_object_agg(o.subject_id::text,
                 case o.mark_status when 'absent' then to_jsonb('AB'::text) when 'exempt' then to_jsonb('EX'::text) else to_jsonb(o.marks) end) as marks
        from o group by o.student_id
      )
      select coalesce(jsonb_agg((to_jsonb(r) - 'student_id') || jsonb_build_object('marks', coalesce(m.marks, '{}'::jsonb))
               order by r.merit_position nulls last, r.name_en), '[]'::jsonb)
      into v_rows
      from public.exam_section_results(v_exam, v_section) r
      left join m on m.student_id = r.student_id;

    when 'fee_collections' then
      if not public.can_view_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
      select r.v_from, r.v_to into v_from, v_to from public._report_range(p) r;
      select coalesce(jsonb_agg(to_jsonb(x) order by x.paid_on, x.receipt_no), '[]'::jsonb) into v_rows
      from (
        select pm.receipt_no, pm.paid_on, fs.student_code, fs.name_en, fs.name_bn, fs.class_name_en, fs.class_name_bn,
               fs.section_name, pm.method, pm.reference, pm.amount, pm.status
        from public.payments pm
        join public.finance_students fs on fs.id = pm.student_id
        where pm.paid_on between v_from and v_to
      ) x;

    when 'fee_outstanding' then
      if p ->> 'year' is null then raise exception 'INVALID_PARAMS'; end if;
      -- finance_outstanding checks finance access.
      select coalesce(jsonb_agg(to_jsonb(r) - 'student_id'), '[]'::jsonb) into v_rows
      from public.finance_outstanding((p ->> 'year')::uuid, (p ->> 'class')::uuid) r;

    else
      raise exception 'UNKNOWN_REPORT';
  end case;

  -- Who exported what (parameters are ids and dates only, never personal data).
  insert into public.audit_logs (actor_id, action, table_name, record_id, metadata)
  values (auth.uid(), 'export', 'reports', p_report,
          jsonb_build_object('params', p, 'rows', jsonb_array_length(v_rows)));

  return jsonb_build_object('rows', v_rows) || v_extra;
end $$;

revoke execute on function public._report_range(jsonb) from public, anon, authenticated;
revoke execute on function public.export_report(text, jsonb) from public, anon;
grant execute on function public.export_report(text, jsonb) to authenticated;

-- ---------- Email notifications --------------------------------------------------------
create type public.notification_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');

create or replace function public.can_manage_notifications()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'school_admin']::public.app_role[]);
$$;

-- Parents can stop school emails; staff can also switch them off on request.
alter table public.guardians add column email_notifications boolean not null default true;

create table public.notification_events (
  event text primary key check (event in (
    'admission_status', 'results_published', 'payment_received', 'attendance_absent', 'fee_reminder'
  )),
  enabled boolean not null default false,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
insert into public.notification_events (event) values
  ('admission_status'), ('results_published'), ('payment_received'), ('attendance_absent'), ('fee_reminder');
create trigger notification_events_stamp before update on public.notification_events
  for each row execute function public.stamp_updated_by();

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event text not null references public.notification_events (event),
  dedupe_key text not null unique,                 -- the same message is never queued twice
  recipient_email text not null check (recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  recipient_name text check (char_length(recipient_name) <= 150),
  language text not null default 'both' check (language in ('bn', 'en', 'both')),
  data jsonb not null default '{}'::jsonb,         -- template values only
  status public.notification_status not null default 'queued',
  attempts int not null default 0,
  last_error text check (char_length(last_error) <= 500),
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notification_outbox_queue_idx on public.notification_outbox (status, send_after);
create index notification_outbox_created_idx on public.notification_outbox (created_at desc);

-- Verified guardians of a student who have an email address and have not opted out.
create or replace function public._guardian_recipients(p_student uuid)
returns table (guardian_id uuid, email text, name text, lang text)
language sql stable security definer set search_path = public as $$
  select g.id, lower(g.email), g.name, coalesce(up.preferred_language, 'both')
  from public.student_guardians sg
  join public.guardians g on g.id = sg.guardian_id
  left join public.user_profiles up on up.id = g.user_id
  where sg.student_id = p_student and sg.verified_at is not null
    and g.email is not null and g.email_notifications;
$$;

create or replace function public._student_brief(p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('student_name_en', s.name_en, 'student_name_bn', s.name_bn, 'student_code', s.student_code)
  from public.students s where s.id = p_student;
$$;

-- Queues one message if its event is switched on. Returns true when queued.
create or replace function public._queue_notification(
  p_event text, p_key text, p_email text, p_name text, p_lang text, p_data jsonb, p_delay interval default interval '0'
) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if nullif(trim(coalesce(p_email, '')), '') is null
     or not exists (select 1 from public.notification_events where event = p_event and enabled) then
    return false;
  end if;
  insert into public.notification_outbox (event, dedupe_key, recipient_email, recipient_name, language, data, send_after)
  values (p_event, p_key, lower(trim(p_email)), left(p_name, 150), coalesce(p_lang, 'both'), coalesce(p_data, '{}'::jsonb), now() + p_delay)
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Application received, and later decisions the applicant needs to know about.
create or replace function public.notify_admission_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.guardian_email is null then return new; end if;
  if tg_op = 'UPDATE' and (new.status is not distinct from old.status
       or new.status not in ('info_required', 'approved', 'rejected', 'admitted')) then
    return new;
  end if;
  perform public._queue_notification(
    'admission_status',
    'admission:' || new.id || ':' || new.status || ':' || floor(extract(epoch from now()))::bigint,
    new.guardian_email, new.guardian_name, 'both',
    jsonb_build_object('reference_no', new.reference_no, 'student_name_en', new.student_name_en,
                       'student_name_bn', new.student_name_bn, 'status', new.status, 'status_note', new.status_note));
  return new;
end $$;
create trigger admission_applications_notify after insert or update of status on public.admission_applications
  for each row execute function public.notify_admission_status();

-- Results published: tell guardians to sign in. Marks are never put in an email.
create or replace function public.notify_results_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.status <> 'published' then
    perform public._queue_notification(
      'results_published', 'results:' || new.id || ':' || x.student_id || ':' || r.guardian_id,
      r.email, r.name, r.lang,
      public._student_brief(x.student_id) || jsonb_build_object('exam_name_en', new.name_en, 'exam_name_bn', new.name_bn))
    from (
      select distinct m.student_id
      from public.student_marks m
      join public.examination_subjects es on es.id = m.examination_subject_id
      where es.examination_id = new.id
    ) x
    cross join lateral public._guardian_recipients(x.student_id) r;
  end if;
  return new;
end $$;
create trigger examinations_notify after update of status on public.examinations
  for each row execute function public.notify_results_published();

create or replace function public.notify_payment_received()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'posted' then
    perform public._queue_notification(
      'payment_received', 'payment:' || new.id || ':' || r.guardian_id, r.email, r.name, r.lang,
      public._student_brief(new.student_id) || jsonb_build_object(
        'receipt_no', new.receipt_no, 'amount', new.amount, 'paid_on', new.paid_on, 'method', new.method))
    from public._guardian_recipients(new.student_id) r;
  end if;
  return new;
end $$;
create trigger payments_notify after insert on public.payments
  for each row execute function public.notify_payment_received();

-- Same-day absences only (not back-dated corrections). Sending waits 30 minutes so a
-- teacher can fix a mistake; a record that is no longer "absent" is skipped at send time.
create or replace function public.notify_absence()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_date date;
begin
  if new.status <> 'absent' or (tg_op = 'UPDATE' and old.status = 'absent') then return new; end if;
  select date into v_date from public.attendance_sessions where id = new.session_id;
  if v_date is distinct from public.school_today() then return new; end if;
  perform public._queue_notification(
    'attendance_absent', 'absent:' || new.session_id || ':' || new.student_id || ':' || r.guardian_id,
    r.email, r.name, r.lang,
    public._student_brief(new.student_id) || jsonb_build_object(
      'date', v_date, 'session_id', new.session_id, 'student_id', new.student_id),
    interval '30 minutes')
  from public._guardian_recipients(new.student_id) r;
  return new;
end $$;
create trigger attendance_records_notify after insert or update of status on public.attendance_records
  for each row execute function public.notify_absence();

-- Accounts staff send due reminders on demand (at most one per guardian per student per day).
create or replace function public.queue_fee_reminders(p_year uuid, p_class uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_manage_finance() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.notification_events where event = 'fee_reminder' and enabled) then
    raise exception 'NOTIFICATIONS_DISABLED';
  end if;
  select count(*) filter (where queued)::int into n
  from (
    select public._queue_notification(
             'fee_reminder', 'fee:' || o.student_id || ':' || r.guardian_id || ':' || public.school_today(),
             r.email, r.name, r.lang,
             public._student_brief(o.student_id) || jsonb_build_object('balance', o.balance, 'oldest_due', o.oldest_due)) as queued
    from public.finance_outstanding(p_year, p_class) o
    cross join lateral public._guardian_recipients(o.student_id) r
  ) x;
  return n;
end $$;

-- A guardian with a portal account switches their own school emails on or off.
create or replace function public.set_my_email_notifications(p_enabled boolean)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_enabled is null then raise exception 'INVALID_INPUT'; end if;
  update public.guardians set email_notifications = p_enabled
  where user_id = auth.uid() and public.has_role('guardian');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Sender API (edge function only, service role) ------------------------------
-- Claims a batch of due messages after housekeeping. Rows stay in the outbox as a log.
create or replace function public.claim_notifications(p_limit int default 25)
returns setof public.notification_outbox language plpgsql security definer set search_path = public as $$
begin
  -- Stale messages are not worth sending (e.g. queued before email was configured).
  update public.notification_outbox set status = 'skipped', last_error = 'expired'
  where status = 'queued' and created_at < now() - interval '3 days';
  update public.notification_outbox set status = 'skipped', last_error = 'event_disabled'
  where status = 'queued' and event in (select event from public.notification_events where not enabled);
  update public.notification_outbox o set status = 'skipped', last_error = 'no_longer_absent'
  where o.status = 'queued' and o.event = 'attendance_absent' and o.send_after <= now()
    and not exists (
      select 1 from public.attendance_records r
      where r.session_id = (o.data ->> 'session_id')::uuid and r.student_id = (o.data ->> 'student_id')::uuid
        and r.status = 'absent'
    );
  -- A sender that crashed mid-batch: try those again.
  update public.notification_outbox set status = 'queued'
  where status = 'sending' and claimed_at < now() - interval '15 minutes';
  -- Delivery log retention.
  delete from public.notification_outbox where status in ('sent', 'skipped') and created_at < now() - interval '180 days';

  return query
    update public.notification_outbox o
    set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
    where o.id in (
      select q.id from public.notification_outbox q
      where q.status = 'queued' and q.send_after <= now()
      order by q.send_after
      limit least(greatest(coalesce(p_limit, 25), 1), 100)
      for update skip locked
    )
    returning o.*;
end $$;

-- Failed sends are retried with growing delays, up to 5 attempts.
create or replace function public.complete_notification(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notification_outbox
  set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end::public.notification_status,
      sent_at = case when p_ok then now() end,
      last_error = case when p_ok then null else left(coalesce(p_error, 'send_failed'), 500) end,
      send_after = case when p_ok then send_after else now() + attempts * attempts * interval '5 minutes' end
  where id = p_id and status = 'sending';
end $$;

-- Staff can put a failed or skipped message back in the queue (this restarts its 3-day window).
create or replace function public.retry_notification(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_notifications() then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.notification_outbox
  set status = 'queued', attempts = 0, last_error = null, send_after = now(), created_at = now()
  where id = p_id and status in ('failed', 'skipped');
  if not found then raise exception 'NOT_RETRYABLE'; end if;
end $$;

-- ---------- Audit, grants & RLS ---------------------------------------------------------
create trigger notification_events_audit after insert or update or delete on public.notification_events
  for each row execute function public.audit_row_change();

revoke execute on function public._guardian_recipients(uuid) from public, anon, authenticated;
revoke execute on function public._student_brief(uuid) from public, anon, authenticated;
revoke execute on function public._queue_notification(text, text, text, text, text, jsonb, interval) from public, anon, authenticated;
revoke execute on function public.notify_admission_status() from public, anon, authenticated;
revoke execute on function public.notify_results_published() from public, anon, authenticated;
revoke execute on function public.notify_payment_received() from public, anon, authenticated;
revoke execute on function public.notify_absence() from public, anon, authenticated;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
revoke execute on function public.complete_notification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.complete_notification(uuid, boolean, text) to service_role;
revoke execute on function public.queue_fee_reminders(uuid, uuid) from public, anon;
revoke execute on function public.set_my_email_notifications(boolean) from public, anon;
revoke execute on function public.retry_notification(uuid) from public, anon;
grant execute on function public.queue_fee_reminders(uuid, uuid) to authenticated;
grant execute on function public.set_my_email_notifications(boolean) to authenticated;
grant execute on function public.retry_notification(uuid) to authenticated;

alter table public.notification_events enable row level security;
alter table public.notification_outbox enable row level security;
revoke all on public.notification_events, public.notification_outbox from anon;
revoke insert, update, delete on public.notification_events, public.notification_outbox from authenticated;
grant update (enabled) on public.notification_events to authenticated;

create policy "notification events: managers read" on public.notification_events for select to authenticated
  using (public.can_manage_notifications());
create policy "notification events: managers switch" on public.notification_events for update to authenticated
  using (public.can_manage_notifications()) with check (public.can_manage_notifications());
create policy "notification outbox: managers read" on public.notification_outbox for select to authenticated
  using (public.can_manage_notifications());
