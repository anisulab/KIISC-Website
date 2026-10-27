import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useLang, type Lang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/auth/AuthProvider';
import { TwoStepSettings } from '@/auth/Mfa';
import { STAFF_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@/hooks/useQuery';
import { QueryView, buttonClass } from '@/components/ui';
import { AdminPageHeader, Panel, SelectField, TextField, useToast } from '@/components/admin/adminUi';

const PHONE_RE = /^[0-9+ -]{6,20}$/;

export default function AccountPage() {
  const { t, setLang } = useLang();
  const ac = t.admin.account;
  usePageMeta(ac.title, undefined, { noindex: true });
  const { me, refreshMe } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(me?.full_name ?? '');
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [language, setLanguage] = useState<Lang>(me?.preferred_language ?? 'bn');
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !me) return;
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = t.admin.common.required;
    if (name.length > 150) errs.name = t.admin.common.tooLong(150);
    if (phone.trim() && !PHONE_RE.test(phone.trim())) errs.phone = t.admin.settings.phoneInvalid;
    setProfileErrors(errs);
    if (Object.keys(errs).length) return;

    setSavingProfile(true);
    const { error } = await supabase
      .from('user_profiles')
      .update({ full_name: name.trim(), phone: phone.trim() || null, preferred_language: language })
      .eq('id', me.id)
      .select('id')
      .single();
    setSavingProfile(false);
    if (error) return toast('error', t.admin.common.saveFailed);
    setLang(language);
    await refreshMe();
    toast('success', ac.saved);
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (password.length < 10) return setPasswordError(t.resetPassword.tooShort);
    if (password !== confirm) return setPasswordError(t.resetPassword.mismatch);
    setPasswordError(null);
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSavingPassword(false);
    if (error) return setPasswordError(error.message);
    setPassword('');
    setConfirm('');
    toast('success', ac.changed);
  };

  return (
    <>
      <AdminPageHeader title={ac.title} subtitle={ac.subtitle} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={ac.profile}>
          <form onSubmit={saveProfile} noValidate className="space-y-4">
            <TextField label={t.admin.users.email} value={me?.email ?? ''} disabled readOnly />
            <TextField label={t.admin.users.name} required value={name} maxLength={150} error={profileErrors.name} onChange={(e) => setName(e.target.value)} />
            <TextField label={t.admin.users.phone} type="tel" value={phone} error={profileErrors.phone} onChange={(e) => setPhone(e.target.value)} />
            <SelectField
              label={ac.preferredLanguage}
              value={language}
              onChange={(e) => setLanguage(e.target.value as Lang)}
              options={[
                { value: 'bn', label: 'বাংলা' },
                { value: 'en', label: 'English' },
              ]}
            />
            <div className="flex justify-end">
              <button type="submit" disabled={savingProfile} className={buttonClass('primary')}>
                {savingProfile && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t.admin.common.save}
              </button>
            </div>
          </form>
        </Panel>
        <Panel title={ac.passwordTitle}>
          <form onSubmit={savePassword} noValidate className="space-y-4">
            <TextField
              label={t.resetPassword.newPassword}
              type="password"
              autoComplete="new-password"
              value={password}
              hint={t.resetPassword.tooShort}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              label={t.resetPassword.confirm}
              type="password"
              autoComplete="new-password"
              value={confirm}
              error={passwordError}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <div className="flex justify-end">
              <button type="submit" disabled={savingPassword} className={buttonClass('primary')}>
                {savingPassword && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t.resetPassword.save}
              </button>
            </div>
          </form>
        </Panel>
        {hasAnyRole(me, STAFF_ROLES) && (
          <Panel title={ac.twoStepTitle}>
            <TwoStepSettings />
          </Panel>
        )}
        {me?.roles.includes('guardian') && <EmailPreferencePanel />}
      </div>
    </>
  );
}

/** Parents choose whether the school may email them (absences, results, receipts, reminders). */
function EmailPreferencePanel() {
  const { t } = useLang();
  const ac = t.admin.account;
  const toast = useToast();
  const { me } = useAuth();
  const { state, retry } = useQuery<{ email: string | null; email_notifications: boolean }[]>(
    (db) => db.from('guardians').select('email,email_notifications').eq('user_id', me?.id ?? ''),
    [me?.id],
  );
  const [saving, setSaving] = useState(false);

  const save = async (enabled: boolean) => {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.rpc('set_my_email_notifications', { p_enabled: enabled });
    setSaving(false);
    if (error) return toast('error', t.admin.common.saveFailed);
    retry();
    toast('success', enabled ? ac.emailsOn : ac.emailsOff);
  };

  return (
    <Panel title={ac.emailTitle}>
      <QueryView state={state} retry={retry} empty={ac.emailNoRecord}>
        {(rows) => {
          const enabled = rows.some((g) => g.email_notifications);
          const emails = [...new Set(rows.map((g) => g.email).filter(Boolean))];
          return (
            <div className="space-y-3 text-sm">
              <p className="text-slate-600">{ac.emailHelp}</p>
              <p>
                <span className="text-slate-500">{ac.emailOnRecord}: </span>
                <span className="font-semibold text-navy-900">{emails.length ? emails.join(', ') : ac.emailNone}</span>
              </p>
              <label className="flex items-center gap-3 font-semibold text-navy-900">
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-navy-300 text-royal-600"
                  checked={enabled}
                  disabled={saving}
                  onChange={(e) => save(e.target.checked)}
                />
                {ac.emailToggle}
              </label>
            </div>
          );
        }}
      </QueryView>
    </Panel>
  );
}
