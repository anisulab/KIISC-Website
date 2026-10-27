-- Tiny subset of pgTAP (plan, is, throws_ok, lives_ok, finish) for running the
-- test files where the pgtap extension is unavailable (PGlite). Functions are
-- SECURITY INVOKER on purpose: test statements must run with the caller's role
-- so that RLS applies exactly as it would through the API.

create or replace function public._tap_next() returns int language sql as $$
  select set_config('tap.run', (coalesce(nullif(current_setting('tap.run', true), ''), '0')::int + 1)::text, true)::int
$$;

create or replace function public._tap_fail() returns void language sql as $$
  select set_config('tap.failed', (coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int + 1)::text, true);
$$;

create or replace function public._tap_result(ok boolean, description text, diag text default null)
returns text language plpgsql as $$
declare n int := public._tap_next();
begin
  if not ok then perform public._tap_fail(); end if;
  return case when ok then 'ok ' else 'not ok ' end || n || ' - ' || description
    || case when not ok and diag is not null then E'\n# ' || diag else '' end;
end $$;

create or replace function public.plan(n int) returns text language plpgsql as $$
begin
  perform set_config('tap.planned', n::text, true);
  return '1..' || n;
end $$;

create or replace function public.is(have anyelement, want anyelement, description text)
returns text language sql as $$
  select public._tap_result(have is not distinct from want, description,
    format('have: %s, want: %s', coalesce(have::text, 'NULL'), coalesce(want::text, 'NULL')))
$$;

create or replace function public.ok(result boolean, description text)
returns text language sql as $$
  select public._tap_result(coalesce(result, false), description);
$$;

create or replace function public.throws_ok(query text, errcode text, errmsg text, description text)
returns text language plpgsql as $$
begin
  begin
    execute query;
  exception when others then
    return public._tap_result(
      sqlstate = errcode and (errmsg is null or sqlerrm = errmsg),
      description, format('got %s: %s', sqlstate, sqlerrm));
  end;
  return public._tap_result(false, description, 'no exception thrown');
end $$;

create or replace function public.lives_ok(query text, description text)
returns text language plpgsql as $$
begin
  begin
    execute query;
  exception when others then
    return public._tap_result(false, description, format('died %s: %s', sqlstate, sqlerrm));
  end;
  return public._tap_result(true, description);
end $$;

create or replace function public.finish() returns setof text language plpgsql as $$
declare
  planned int := nullif(current_setting('tap.planned', true), '')::int;
  ran int := coalesce(nullif(current_setting('tap.run', true), ''), '0')::int;
  failed int := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int;
begin
  if planned is distinct from ran then
    return next format('# Looks like you planned %s tests but ran %s.', planned, ran);
  end if;
  if failed > 0 then
    return next format('# Looks like you failed %s test(s) of %s.', failed, ran);
  end if;
end $$;
