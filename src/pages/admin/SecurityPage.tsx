import { useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, Stethoscope } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { useMfa } from '@/auth/Mfa';
import { QueryView, buttonClass, cx } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, InlineNotice, Panel, useToast } from '@/components/admin/adminUi';

interface StaffRow {
  user_id: string;
  full_name: string;
  email: string | null;
  roles: string[];
  has_mfa: boolean;
}

export default function SecurityPage() {
  const { t } = useLang();
  const s = t.admin.security;
  usePageMeta(s.title, undefined, { noindex: true });
  const toast = useToast();
  const mfa = useMfa();
  const staff = useQuery<StaffRow[]>((db) => db.rpc('staff_mfa_status'), [mfa.required]);
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<{ integrity: { check_name: string; problems: number }[]; fingerprint: { item: string; value: number }[] } | null>(null);
  const [checking, setChecking] = useState(false);

  const rows = staff.state.status === 'ready' ? staff.state.data : [];
  const missing = rows.filter((r) => !r.has_mfa).length;

  const setRequired = async (required: boolean) => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_staff_mfa_required', { p_required: required });
    setBusy(false);
    setConfirm(null);
    if (error) return toast('error', error.message === 'MFA_REQUIRED_FIRST' ? s.mfaFirst : t.admin.common.saveFailed);
    await mfa.refresh();
    toast('success', required ? s.nowRequired : s.nowOptional);
  };

  const runChecks = async () => {
    if (!supabase) return;
    setChecking(true);
    const [integrity, fingerprint] = await Promise.all([supabase.rpc('integrity_report'), supabase.rpc('data_fingerprint')]);
    setChecking(false);
    if (integrity.error || fingerprint.error) return toast('error', s.checkFailed);
    setChecks({ integrity: integrity.data ?? [], fingerprint: fingerprint.data ?? [] });
  };

  return (
    <>
      <AdminPageHeader title={s.title} subtitle={s.subtitle} />

      <Panel title={s.mfaTitle}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {mfa.required ? (
              <>
                <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
                <span className="text-emerald-800">{s.required}</span>
              </>
            ) : (
              <>
                <ShieldAlert className="h-5 w-5 text-gold-600" aria-hidden />
                <span className="text-navy-900">{s.optional}</span>
              </>
            )}
          </p>
          <button
            type="button"
            disabled={busy || mfa.loading}
            onClick={() => setConfirm(!mfa.required)}
            className={buttonClass(mfa.required ? 'outline' : 'primary')}
          >
            {mfa.required ? s.makeOptional : s.require}
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600">{s.mfaHelp}</p>
        {!mfa.required && missing > 0 && <InlineNotice tone="warning">{s.missingWarning(missing)}</InlineNotice>}
        <QueryView state={staff.state} retry={staff.retry} empty={t.admin.common.noRecords}>
          {(list) => (
            <ul className="mt-4 divide-y divide-slate-100 text-sm">
              {list.map((r) => (
                <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-medium text-navy-900">{r.full_name || r.email}</span>
                    <span className="block text-xs text-slate-500">{r.roles.map((x) => t.roles[x as keyof typeof t.roles] ?? x).join(', ')}</span>
                  </span>
                  <span
                    className={cx(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      r.has_mfa ? 'bg-emerald-100 text-emerald-800' : 'bg-gold-100 text-gold-600',
                    )}
                  >
                    {r.has_mfa ? s.hasMfa : s.noMfa}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>

      <Panel
        title={s.integrityTitle}
        className="mt-6"
        actions={
          <button type="button" onClick={runChecks} disabled={checking} className={buttonClass('outline')}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Stethoscope className="h-4 w-4" aria-hidden />}
            {s.runChecks}
          </button>
        }
      >
        <p className="text-sm text-slate-600">{s.integrityHelp}</p>
        {checks && (
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <ul className="divide-y divide-slate-100 text-sm">
              {checks.integrity.map((c) => (
                <li key={c.check_name} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-navy-900">{s.checks[c.check_name] ?? c.check_name}</span>
                  <span className={cx('font-semibold', c.problems ? 'text-red-700' : 'text-emerald-700')}>
                    {c.problems ? s.problems(c.problems) : s.ok}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.fingerprint}</p>
              <ul className="divide-y divide-slate-100 text-sm">
                {checks.fingerprint.map((f) => (
                  <li key={f.item} className="flex justify-between gap-3 py-1.5">
                    <span className="font-mono text-xs text-slate-600">{f.item}</span>
                    <span className="font-semibold tabular-nums text-navy-900">{Number(f.value).toLocaleString('en-IN')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === false}
        busy={busy}
        title={confirm ? s.requireTitle : s.optionalTitle}
        body={confirm ? s.requireBody : s.optionalBody}
        confirmLabel={confirm ? s.require : s.makeOptional}
        onCancel={() => setConfirm(null)}
        onConfirm={() => setRequired(Boolean(confirm))}
      />
    </>
  );
}
