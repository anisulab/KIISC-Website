import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useInstitutionContext } from '@/hooks/useInstitution';
import { useAuth } from '@/auth/AuthProvider';
import { hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { IMAGE_TYPES, removePublicFile, uploadPublicFile } from '@/lib/storage';
import { Spinner, buttonClass } from '@/components/ui';
import { AdminPageHeader, InlineNotice, Panel, TextAreaField, TextField, useToast } from '@/components/admin/adminUi';
import { FileInput } from './content/ContentPages';

type Key =
  | 'name_en' | 'name_bn' | 'address_en' | 'address_bn' | 'phone' | 'whatsapp' | 'email'
  | 'about_en' | 'about_bn' | 'mission_en' | 'mission_bn' | 'vision_en' | 'vision_bn'
  | 'eiin' | 'established_year' | 'board_affiliation' | 'office_hours_en' | 'office_hours_bn';

const SECTIONS: { key: 'identity' | 'contact' | 'statements' | 'official' | 'office'; fields: { name: Key; multiline?: boolean; required?: boolean }[] }[] = [
  { key: 'identity', fields: [{ name: 'name_en', required: true }, { name: 'name_bn' }] },
  {
    key: 'contact',
    fields: [
      { name: 'address_en', required: true },
      { name: 'address_bn' },
      { name: 'phone', required: true },
      { name: 'whatsapp' },
      { name: 'email', required: true },
    ],
  },
  {
    key: 'statements',
    fields: [
      { name: 'about_en', multiline: true },
      { name: 'about_bn', multiline: true },
      { name: 'mission_en', multiline: true },
      { name: 'mission_bn', multiline: true },
      { name: 'vision_en', multiline: true },
      { name: 'vision_bn', multiline: true },
    ],
  },
  { key: 'official', fields: [{ name: 'eiin' }, { name: 'established_year' }, { name: 'board_affiliation' }] },
  { key: 'office', fields: [{ name: 'office_hours_en', multiline: true }, { name: 'office_hours_bn', multiline: true }] },
];

const PHONE_RE = /^[0-9+ -]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SettingsPage() {
  const { t } = useLang();
  const s = t.admin.settings;
  usePageMeta(s.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canEdit = hasAnyRole(me, ['super_admin']);
  const { refresh } = useInstitutionContext();
  const toast = useToast();

  const [values, setValues] = useState<Record<Key, string> | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | 'remove' | undefined>();
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('institution_settings')
      .select('*')
      .single()
      .then(({ data }) => {
        if (!data) return;
        const v = {} as Record<Key, string>;
        for (const sec of SECTIONS) for (const f of sec.fields) v[f.name] = data[f.name] == null ? '' : String(data[f.name]);
        setValues(v);
        setLogoPath(data.logo_path);
      });
  }, []);

  if (!values) return <Spinner />;

  const validate = () => {
    const errs: Partial<Record<Key, string>> = {};
    for (const sec of SECTIONS) for (const f of sec.fields) if (f.required && !values[f.name].trim()) errs[f.name] = t.admin.common.required;
    if (values.phone && !PHONE_RE.test(values.phone.trim())) errs.phone = s.phoneInvalid;
    if (values.whatsapp && !PHONE_RE.test(values.whatsapp.trim())) errs.whatsapp = s.phoneInvalid;
    if (values.email && !EMAIL_RE.test(values.email.trim())) errs.email = s.emailInvalid;
    if (values.eiin && !/^[0-9]{6}$/.test(values.eiin.trim())) errs.eiin = s.eiinInvalid;
    const year = values.established_year.trim();
    if (year && !(/^\d{4}$/.test(year) && Number(year) >= 1800 && Number(year) <= 2100)) errs.established_year = s.yearInvalid;
    if (values.name_en.length > 200) errs.name_en = t.admin.common.tooLong(200);
    if (values.name_bn.length > 200) errs.name_bn = t.admin.common.tooLong(200);
    return errs;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !canEdit) return;
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return toast('error', t.admin.common.fixErrors);

    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) payload[k] = v.trim() === '' ? null : v.trim();
    payload.established_year = values.established_year.trim() ? Number(values.established_year) : null;

    let uploaded: string | null = null;
    if (logoFile instanceof File) {
      try {
        uploaded = await uploadPublicFile('branding', logoFile);
        payload.logo_path = uploaded;
      } catch {
        setSaving(false);
        return toast('error', t.admin.upload.uploadFailed);
      }
    } else if (logoFile === 'remove') {
      payload.logo_path = null;
    }

    const { error } = await supabase.from('institution_settings').update(payload).eq('id', true).select('id').single();
    setSaving(false);
    if (error) {
      await removePublicFile(uploaded);
      return toast('error', t.admin.common.saveFailed);
    }
    if (logoFile !== undefined) {
      await removePublicFile(logoPath);
      setLogoPath((payload.logo_path as string | null) ?? null);
      setLogoFile(undefined);
    }
    await refresh();
    toast('success', t.admin.common.saved);
  };

  return (
    <>
      <AdminPageHeader title={s.title} subtitle={s.subtitle} />
      <div className="mb-6 space-y-3">
        {!canEdit && <InlineNotice>{s.superOnly}</InlineNotice>}
        <InlineNotice tone="warning">{s.verifiedOnly}</InlineNotice>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {SECTIONS.map((sec) => (
          <Panel key={sec.key} title={s.sections[sec.key]}>
            <fieldset disabled={!canEdit} className="grid gap-5 md:grid-cols-2">
              {sec.key === 'identity' && (
                <FileInput
                  label={s.fields.logo_path}
                  className="md:col-span-2"
                  accept={IMAGE_TYPES}
                  currentPath={logoFile === 'remove' ? null : logoPath}
                  pending={logoFile}
                  onFile={setLogoFile}
                />
              )}
              {sec.fields.map((f) => {
                const props = {
                  label: s.fields[f.name],
                  value: values[f.name],
                  required: f.required,
                  error: errors[f.name],
                  lang: f.name.endsWith('_bn') ? 'bn' : undefined,
                };
                const onChange = (v: string) => {
                  setValues((prev) => (prev ? { ...prev, [f.name]: v } : prev));
                  setErrors((prev) => ({ ...prev, [f.name]: undefined }));
                };
                return f.multiline ? (
                  <TextAreaField key={f.name} {...props} rows={4} onChange={(e) => onChange(e.target.value)} />
                ) : (
                  <TextField
                    key={f.name}
                    {...props}
                    inputMode={f.name === 'eiin' || f.name === 'established_year' ? 'numeric' : undefined}
                    type={f.name === 'email' ? 'email' : f.name === 'phone' || f.name === 'whatsapp' ? 'tel' : 'text'}
                    onChange={(e) => onChange(e.target.value)}
                  />
                );
              })}
            </fieldset>
          </Panel>
        ))}
        {canEdit && (
          <div className="sticky bottom-4 flex justify-end">
            <button type="submit" disabled={saving} className={buttonClass('primary', 'shadow-lg')}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {saving ? t.admin.common.saving : t.admin.common.save}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
