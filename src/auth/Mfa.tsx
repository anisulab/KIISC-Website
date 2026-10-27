import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Loader2, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useAuth } from '@/auth/AuthProvider';
import { STAFF_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { Logo, Spinner, buttonClass, inputClass } from '@/components/ui';

interface Factor {
  id: string;
  friendly_name?: string | null;
  factor_type: string;
  status: string;
  created_at: string;
}

export interface MfaState {
  loading: boolean;
  /** The school requires staff to use a second factor. */
  required: boolean;
  /** This session has passed a second factor. */
  verified: boolean;
  /** Verified TOTP factors of this user. */
  factors: Factor[];
  refresh: () => Promise<void>;
}

/** MFA status of the signed-in user (Supabase Auth TOTP factors) and the school policy. */
export function useMfa(): MfaState {
  const { session } = useAuth();
  const [state, setState] = useState<Omit<MfaState, 'refresh'>>({ loading: true, required: false, verified: false, factors: [] });

  const refresh = useCallback(async () => {
    if (!supabase || !session) {
      setState({ loading: false, required: false, verified: false, factors: [] });
      return;
    }
    const [aal, list, policy] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
      supabase.from('security_settings').select('require_staff_mfa').maybeSingle(),
    ]);
    setState({
      loading: false,
      required: Boolean((policy.data as { require_staff_mfa?: boolean } | null)?.require_staff_mfa),
      verified: aal.data?.currentLevel === 'aal2',
      factors: ((list.data?.all ?? []) as Factor[]).filter((f) => f.factor_type === 'totp' && f.status === 'verified'),
    });
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}

function mfaError(t: ReturnType<typeof useLang>['t'], message?: string) {
  const m = t.mfa.errors;
  if (!message) return m.generic;
  if (/invalid|expired|incorrect/i.test(message)) return m.badCode;
  if (/rate|too many/i.test(message)) return m.tooMany;
  return m.generic;
}

const codeOk = (code: string) => /^\d{6}$/.test(code);

/** Six-digit code from the authenticator app for an existing factor. */
function ChallengeForm({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const { t } = useLang();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (!codeOk(code)) return setError(t.mfa.errors.format);
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (err) {
      setCode('');
      return setError(mfaError(t, err.message));
    }
    onDone();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <label className="block text-sm font-semibold text-navy-800">
        {t.mfa.code}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          className={inputClass + ' mt-1.5 text-center font-mono text-2xl tracking-[0.5em]'}
          aria-invalid={Boolean(error)}
        />
      </label>
      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className={buttonClass('primary', 'w-full py-3')}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {t.mfa.verify}
      </button>
    </form>
  );
}

/** Sets up an authenticator app: QR code (or key), then a first code to confirm. */
export function EnrollForm({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const [enrolment, setEnrolment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!supabase) return;
    setError(null);
    // Leftovers from an abandoned setup would block a new one.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of (list?.all ?? []) as Factor[]) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (err || !data) return setError(mfaError(t, err?.message));
    setEnrolment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  if (!enrolment) {
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          {t.mfa.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <button type="button" onClick={start} className={buttonClass('primary', 'w-full py-3')}>
          <Smartphone className="h-4 w-4" aria-hidden />
          {t.mfa.start}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">{t.mfa.scan}</p>
      <img src={enrolment.qr} alt={t.mfa.qrAlt} className="mx-auto h-48 w-48 rounded-lg border border-slate-200 bg-white p-2" />
      <p className="text-center text-xs text-slate-500">
        {t.mfa.manualKey}: <span className="select-all break-all font-mono text-navy-900">{enrolment.secret}</span>
      </p>
      <ChallengeForm factorId={enrolment.id} onDone={onDone} />
    </div>
  );
}

function GateCard({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  const { t } = useLang();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="h-12 w-12" />
          <ShieldCheck className="mt-4 h-6 w-6 text-royal-600" aria-hidden />
          <h1 className="heading mt-2 text-xl font-bold text-navy-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-600">{body}</p>
        </div>
        {children}
        <button
          type="button"
          onClick={async () => {
            await supabase?.auth.signOut();
            window.location.assign('/login');
          }}
          className="mx-auto mt-6 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-navy-900"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {t.admin.menu.signOut}
        </button>
      </div>
    </div>
  );
}

/**
 * Staff console gate: asks for the authenticator code whenever the user has set
 * one up, and requires setting one up when the school's policy says so. The
 * database enforces the same rule, so this screen is a convenience, not the control.
 */
export function MfaGate({ children }: { children: ReactNode }) {
  const { t } = useLang();
  const { me } = useAuth();
  const mfa = useMfa();
  const staff = hasAnyRole(me, STAFF_ROLES);

  if (!staff) return <>{children}</>;
  if (mfa.loading) return <Spinner />;
  if (mfa.factors.length && !mfa.verified) {
    return (
      <GateCard title={t.mfa.challengeTitle} body={t.mfa.challengeBody}>
        <ChallengeForm factorId={mfa.factors[0].id} onDone={mfa.refresh} />
      </GateCard>
    );
  }
  if (mfa.required && !mfa.factors.length) {
    return (
      <GateCard title={t.mfa.requiredTitle} body={t.mfa.requiredBody}>
        <EnrollForm onDone={mfa.refresh} />
      </GateCard>
    );
  }
  return <>{children}</>;
}

/** "Two-step verification" panel content for the account page. */
export function TwoStepSettings() {
  const { t, formatDate } = useLang();
  const mfa = useMfa();
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mfa.loading) return <Spinner />;
  if (setting) {
    return (
      <EnrollForm
        onDone={async () => {
          setSetting(false);
          await mfa.refresh();
        }}
      />
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">{t.mfa.help}</p>
      {mfa.factors.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {mfa.factors.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 p-3">
              <span className="flex items-center gap-2 font-medium text-navy-900">
                <KeyRound className="h-4 w-4 text-emerald-600" aria-hidden />
                {t.mfa.appOn(formatDate(f.created_at, { day: 'numeric', month: 'short', year: 'numeric' }))}
              </span>
              {!mfa.required && (
                <button
                  type="button"
                  className={buttonClass('ghost', 'px-2 py-1 text-xs text-red-600 hover:bg-red-50')}
                  onClick={async () => {
                    if (!supabase || !window.confirm(t.mfa.removeConfirm)) return;
                    const { error: err } = await supabase.auth.mfa.unenroll({ factorId: f.id });
                    if (err) return setError(t.mfa.errors.removeNeedsCode);
                    await mfa.refresh();
                  }}
                >
                  {t.mfa.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" onClick={() => setSetting(true)} className={buttonClass('primary')}>
          <Smartphone className="h-4 w-4" aria-hidden />
          {t.mfa.setUp}
        </button>
      )}
      {mfa.required && <p className="text-xs text-slate-500">{t.mfa.requiredNote}</p>}
      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}
