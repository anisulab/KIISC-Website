import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/integrations/supabase/client';
import { Card, Container, Logo, Spinner, buttonClass, inputClass } from '@/components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="hero-pattern">
      <Container className="flex justify-center py-16 sm:py-24">
        <Card className="w-full max-w-md p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <Logo className="h-14 w-14" />
            <h1 className="heading mt-4 text-2xl font-bold text-navy-900">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
          </div>
          {children}
        </Card>
      </Container>
    </div>
  );
}

function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'mb-4 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800'
          : 'mb-4 flex gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800'
      }
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {children}
    </div>
  );
}

function BackendMissing() {
  const { t } = useLang();
  return <Alert tone="error">{t.common.backendTitle}. {t.common.backendBody}</Alert>;
}

export function LoginPage() {
  const { t } = useLang();
  const { session, initializing } = useAuth();
  const navigate = useNavigate();
  const idle = new URLSearchParams(window.location.search).get('reason') === 'idle';
  usePageMeta(t.login.title, t.login.subtitle, { noindex: true });

  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (initializing) return <Spinner />;
  if (session) return <Navigate to="/portal" replace />;

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError(t.login.required);
    if (!EMAIL_RE.test(email.trim())) return setError(t.login.invalidEmail);
    if (!supabase) return;
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      // Same message for unknown email and wrong password, to avoid account enumeration.
      setError(err.status === 429 ? t.login.tooMany : t.login.invalid);
      return;
    }
    navigate('/portal', { replace: true });
  };

  const onReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError(t.login.invalidEmail);
    if (!supabase) return;
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (err?.status === 429) return setError(t.login.tooMany);
    // Always show the neutral message, whether or not the account exists.
    setNotice(t.login.resetSent);
  };

  return (
    <AuthShell title={t.login.title} subtitle={t.login.subtitle}>
      {!supabase && <BackendMissing />}
      {idle && !error && !notice && <Alert tone="success">{t.login.idle}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <form onSubmit={mode === 'signin' ? onSignIn : onReset} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-navy-800">
            {t.login.email}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        {mode === 'signin' && (
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-navy-800">
              {t.login.password}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
        )}
        <button type="submit" disabled={busy || !supabase} className={buttonClass('primary', 'w-full py-3')}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {mode === 'signin' ? (busy ? t.login.signingIn : t.login.signIn) : t.login.sendReset}
        </button>
      </form>
      <div className="mt-4 text-center text-sm">
        <button
          type="button"
          className="font-semibold text-royal-700 hover:underline"
          onClick={() => {
            setMode(mode === 'signin' ? 'reset' : 'signin');
            setError(null);
            setNotice(null);
          }}
        >
          {mode === 'signin' ? t.login.forgot : t.login.backToSignIn}
        </button>
      </div>
      <p className="mt-6 flex gap-2 rounded-lg bg-navy-50 p-3 text-xs text-slate-600">
        <ShieldCheck className="h-4 w-4 shrink-0 text-royal-600" aria-hidden />
        {t.login.noAccount}
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useLang();
  const { session, initializing, recovering } = useAuth();
  usePageMeta(t.resetPassword.title, undefined, { noindex: true });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (initializing) return <Spinner />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError(t.resetPassword.tooShort);
    if (password !== confirm) return setError(t.resetPassword.mismatch);
    if (!supabase) return;
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    setDone(true);
  };

  const linkValid = Boolean(session) && (recovering || done);

  return (
    <AuthShell title={t.resetPassword.title}>
      {!linkValid && !done ? (
        <>
          <Alert tone="error">{t.resetPassword.invalidLink}</Alert>
          <Link to="/login" className={buttonClass('outline', 'w-full')}>
            {t.login.backToSignIn}
          </Link>
        </>
      ) : done ? (
        <>
          <Alert tone="success">{t.resetPassword.saved}</Alert>
          <Link to="/portal" className={buttonClass('primary', 'w-full')}>
            {t.portal.title}
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold text-navy-800">
              {t.resetPassword.newPassword}
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold text-navy-800">
              {t.resetPassword.confirm}
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
          <button type="submit" disabled={busy} className={buttonClass('primary', 'w-full py-3')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t.resetPassword.save}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
