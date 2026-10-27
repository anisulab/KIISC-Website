import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Loader2, Plus, Search, ShieldCheck, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth, type AppRole } from '@/auth/AuthProvider';
import { ALL_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeSearch } from '@/lib/content';
import { invokeFunction } from '@/lib/functions';
import { Pagination, QueryView, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, InlineNotice, Modal, Panel, SelectField, TextField, useToast } from '@/components/admin/adminUi';

const PAGE_SIZE = 25;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function callAdminUsers(body: Record<string, unknown>) {
  return invokeFunction('admin-users', { ...body, redirect_to: `${window.location.origin}/reset-password` });
}

function RoleChips({ roles }: { roles: AppRole[] }) {
  const { t } = useLang();
  if (!roles.length) return <span className="text-xs text-slate-400">{t.admin.users.noRoles}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span key={r} className="whitespace-nowrap rounded-full bg-royal-50 px-2 py-0.5 text-xs font-semibold text-royal-700">
          {t.roles[r]}
        </span>
      ))}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useLang();
  return (
    <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-semibold', active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700')}>
      {active ? t.admin.users.active : t.admin.users.inactive}
    </span>
  );
}

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  created_at: string;
  roles: { role: AppRole; revoked_at: string | null }[];
}

export function UsersListPage() {
  const { t, formatDate } = useLang();
  const u = t.admin.users;
  usePageMeta(u.title, undefined, { noindex: true });
  const { me } = useAuth();
  const isSuper = hasAnyRole(me, ['super_admin']);
  const [params, setParams] = useSearchParams();
  const q = sanitizeSearch(params.get('q') ?? '');
  const role = ALL_ROLES.includes(params.get('role') as AppRole) ? (params.get('role') as AppRole) : null;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draftQ, setDraftQ] = useState(q);
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const { state, retry } = useQuery<UserRow[]>(
    (db) => {
      // Two embeddings of role_assignments: one to display, one (inner) to filter by role.
      const select = role
        ? 'id,full_name,email,is_active,created_at,roles:role_assignments(role,revoked_at),filter:role_assignments!inner(role,revoked_at)'
        : 'id,full_name,email,is_active,created_at,roles:role_assignments(role,revoked_at)';
      let query = db.from('user_profiles').select(select, { count: 'exact' });
      if (role) query = query.eq('filter.role', role).is('filter.revoked_at', null);
      if (q) query = query.or(`full_name.ilike.*${q}*,email.ilike.*${q}*`);
      const from = (page - 1) * PAGE_SIZE;
      return query.order('full_name').range(from, from + PAGE_SIZE - 1);
    },
    [q, role, page, reload],
  );

  return (
    <>
      <AdminPageHeader
        title={u.title}
        subtitle={u.subtitle}
        actions={
          isSuper ? (
            <button type="button" onClick={() => setCreating(true)} className={buttonClass('primary')}>
              <Plus className="h-4 w-4" aria-hidden />
              {u.add}
            </button>
          ) : undefined
        }
      />
      {!isSuper && (
        <div className="mb-4">
          <InlineNotice>{u.onlySuper}</InlineNotice>
        </div>
      )}
      <Panel>
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <form
            role="search"
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ q: sanitizeSearch(draftQ) || null, page: null });
            }}
          >
            <label htmlFor="user-search" className="sr-only">
              {t.common.search}
            </label>
            <input
              id="user-search"
              type="search"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder={u.searchPlaceholder}
              className={inputClass}
              maxLength={80}
            />
            <button type="submit" className={buttonClass('outline', 'px-3')} aria-label={t.common.search}>
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <select
            aria-label={u.roles}
            value={role ?? ''}
            onChange={(e) => setParam({ role: e.target.value || null, page: null })}
            className={inputClass + ' md:w-56'}
          >
            <option value="">{u.allRoles}</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
        </div>
        <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
          {(rows, count) => (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{u.name}</th>
                      <th className="px-3 py-2 font-semibold">{u.roles}</th>
                      <th className="px-3 py-2 font-semibold">{t.admin.common.status}</th>
                      <th className="px-3 py-2 font-semibold">{u.created_at}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-3 py-3">
                          <Link to={r.id} className="font-medium text-navy-900 hover:text-royal-700">
                            {r.full_name || r.email}
                          </Link>
                          {r.id === me?.id && <span className="ml-2 text-xs text-gold-600">({u.you})</span>}
                          <p className="text-xs text-slate-500">{r.email}</p>
                        </td>
                        <td className="px-3 py-3">
                          <RoleChips roles={r.roles.filter((x) => !x.revoked_at).map((x) => x.role)} />
                        </td>
                        <td className="px-3 py-3">
                          <ActiveBadge active={r.is_active} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)} onChange={(p) => setParam({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </QueryView>
      </Panel>
      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setReload((n) => n + 1);
        }}
      />
    </>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useLang();
  const u = t.admin.users;
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName('');
    setEmail('');
    setRole('');
    setErrors({});
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t.admin.common.required;
    if (!EMAIL_RE.test(email.trim())) errs.email = t.login.invalidEmail;
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    const result = await callAdminUsers({ action: 'create_user', full_name: name.trim(), email: email.trim(), role: role || null });
    setBusy(false);
    if (!result.ok) {
      if (result.code === 'email_exists') setErrors({ email: u.emailExists });
      else toast('error', result.code === 'service_unavailable' ? u.serviceUnavailable : t.admin.common.saveFailed);
      return;
    }
    if (result.data.role_error) toast('error', u.createdRoleFailed);
    else if (result.data.email_error) toast('error', u.createdEmailFailed);
    else toast('success', u.created);
    reset();
    onCreated();
  };

  return (
    <Modal
      open={open}
      title={u.createTitle}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="text-sm text-slate-600">{u.createHelp}</p>
        <TextField label={u.name} required value={name} maxLength={150} error={errors.name} onChange={(e) => setName(e.target.value)} />
        <TextField label={u.email} required type="email" autoComplete="off" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
        <SelectField
          label={u.initialRole}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          options={[{ value: '', label: u.noInitialRole }, ...ALL_ROLES.map((r) => ({ value: r, label: t.roles[r] }))]}
        />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className={buttonClass('outline')} onClick={onClose} disabled={busy}>
            {t.admin.common.cancel}
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {u.add}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface UserDetail {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  role_assignments: { id: string; role: AppRole; granted_at: string; revoked_at: string | null }[];
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { t, formatDate } = useLang();
  const u = t.admin.users;
  usePageMeta(u.detailTitle, undefined, { noindex: true });
  const { me } = useAuth();
  const toast = useToast();
  const isSuper = hasAnyRole(me, ['super_admin']);
  const isSelf = me?.id === id;
  const [reload, setReload] = useState(0);
  const [grantRole, setGrantRole] = useState<AppRole | ''>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'revoke'; assignmentId: string; role: AppRole } | { kind: 'deactivate' } | null>(null);

  const { state, retry } = useQuery<UserDetail | null>(
    (db) =>
      db
        .from('user_profiles')
        .select('id,full_name,email,phone,is_active,created_at,role_assignments(id,role,granted_at,revoked_at)')
        .eq('id', id)
        .order('granted_at', { referencedTable: 'role_assignments', ascending: false })
        .maybeSingle(),
    [id, reload],
  );

  const user = state.status === 'ready' ? state.data : null;
  const activeRoles = user?.role_assignments.filter((r) => !r.revoked_at) ?? [];
  const isTargetSuper = activeRoles.some((r) => r.role === 'super_admin');
  const canEditRoles = isSuper && !isSelf;
  const canToggleActive = !isSelf && (isSuper || !isTargetSuper);

  const grant = async () => {
    if (!grantRole || !supabase) return;
    setBusy('grant');
    const { error } = await supabase.from('role_assignments').insert({ user_id: id, role: grantRole });
    setBusy(null);
    if (error) return toast('error', t.admin.common.saveFailed);
    toast('success', u.granted);
    setGrantRole('');
    setReload((n) => n + 1);
  };

  const runConfirmed = async () => {
    if (!confirm || !supabase) return;
    setBusy('confirm');
    if (confirm.kind === 'revoke') {
      const { error } = await supabase
        .from('role_assignments')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', confirm.assignmentId)
        .select('id')
        .single();
      setBusy(null);
      setConfirm(null);
      if (error) return toast('error', t.admin.common.saveFailed);
      toast('success', u.revoked);
    } else {
      const result = await callAdminUsers({ action: 'set_active', user_id: id, active: false });
      setBusy(null);
      setConfirm(null);
      if (!result.ok) return toast('error', result.code === 'service_unavailable' ? u.serviceUnavailable : t.admin.common.saveFailed);
      toast('success', u.deactivated);
    }
    setReload((n) => n + 1);
  };

  const reactivate = async () => {
    setBusy('activate');
    const result = await callAdminUsers({ action: 'set_active', user_id: id, active: true });
    setBusy(null);
    if (!result.ok) return toast('error', result.code === 'service_unavailable' ? u.serviceUnavailable : t.admin.common.saveFailed);
    toast('success', u.activated);
    setReload((n) => n + 1);
  };

  const sendReset = async () => {
    setBusy('reset');
    const result = await callAdminUsers({ action: 'send_password_reset', user_id: id });
    setBusy(null);
    if (!result.ok) return toast('error', result.code === 'service_unavailable' ? u.serviceUnavailable : t.admin.common.saveFailed);
    toast('success', u.resetSent);
  };

  return (
    <>
      <Link to="/admin/users" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <QueryView state={state} retry={retry} empty={u.notFound} isEmpty={(d) => d === null}>
        {(data) =>
          data && (
            <>
              <AdminPageHeader title={data.full_name || data.email || u.detailTitle} subtitle={data.email ?? undefined} />
              {isSelf && (
                <div className="mb-4">
                  <InlineNotice>{u.selfNote}</InlineNotice>
                </div>
              )}
              <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
                <Panel title={u.detailTitle}>
                  <dl className="divide-y divide-slate-100 text-sm">
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">{u.email}</dt>
                      <dd className="break-all text-right font-medium text-navy-900">{data.email}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">{u.phone}</dt>
                      <dd className="text-right font-medium text-navy-900">{data.phone || '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">{t.admin.common.status}</dt>
                      <dd>
                        <ActiveBadge active={data.is_active} />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">{u.created_at}</dt>
                      <dd className="text-right font-medium text-navy-900">{formatDate(data.created_at)}</dd>
                    </div>
                  </dl>
                  <div className="mt-5 flex flex-col gap-2">
                    <button type="button" onClick={sendReset} disabled={busy !== null} className={buttonClass('outline', 'justify-start')}>
                      {busy === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
                      {u.sendReset}
                    </button>
                    {canToggleActive &&
                      (data.is_active ? (
                        <button
                          type="button"
                          onClick={() => setConfirm({ kind: 'deactivate' })}
                          disabled={busy !== null}
                          className={buttonClass('outline', 'justify-start text-red-700 hover:border-red-400 hover:text-red-700')}
                        >
                          <UserX className="h-4 w-4" aria-hidden />
                          {u.deactivate}
                        </button>
                      ) : (
                        <button type="button" onClick={reactivate} disabled={busy !== null} className={buttonClass('outline', 'justify-start')}>
                          {busy === 'activate' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
                          {u.activate}
                        </button>
                      ))}
                  </div>
                </Panel>

                <Panel title={u.roles}>
                  {!isSuper && (
                    <div className="mb-4">
                      <InlineNotice>{u.onlySuper}</InlineNotice>
                    </div>
                  )}
                  <ul className="divide-y divide-slate-100">
                    {data.role_assignments.length === 0 && <li className="py-3 text-sm text-slate-500">{u.noRoles}</li>}
                    {data.role_assignments.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                        <div>
                          <p className={cx('font-medium', r.revoked_at ? 'text-slate-400 line-through' : 'text-navy-900')}>{t.roles[r.role]}</p>
                          <p className="text-xs text-slate-500">
                            {formatDate(r.granted_at)}
                            {r.revoked_at && ` – ${formatDate(r.revoked_at)}`}
                          </p>
                        </div>
                        {!r.revoked_at && canEditRoles && (
                          <button
                            type="button"
                            onClick={() => setConfirm({ kind: 'revoke', assignmentId: r.id, role: r.role })}
                            className={buttonClass('ghost', 'text-red-600 hover:bg-red-50')}
                          >
                            <ShieldOff className="h-4 w-4" aria-hidden />
                            {u.revoke}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {canEditRoles && (
                    <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
                      <label htmlFor="grant-role" className="sr-only">
                        {u.grantRole}
                      </label>
                      <select id="grant-role" value={grantRole} onChange={(e) => setGrantRole(e.target.value as AppRole | '')} className={inputClass}>
                        <option value="">{u.grantRole}…</option>
                        {ALL_ROLES.filter((r) => !activeRoles.some((a) => a.role === r)).map((r) => (
                          <option key={r} value={r}>
                            {t.roles[r]}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={grant} disabled={!grantRole || busy !== null} className={buttonClass('primary', 'shrink-0')}>
                        {busy === 'grant' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                        {u.grant}
                      </button>
                    </div>
                  )}
                </Panel>
              </div>
            </>
          )
        }
      </QueryView>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'revoke' ? u.revokeTitle : u.deactivateTitle}
        body={confirm?.kind === 'revoke' ? u.revokeBody(t.roles[confirm.role]) : u.deactivateBody}
        confirmLabel={confirm?.kind === 'revoke' ? u.revoke : u.deactivate}
        busy={busy === 'confirm'}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
