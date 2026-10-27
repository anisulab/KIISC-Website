import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileCheck2, Loader2, Lock, Paperclip, Printer, Search } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import {
  GENDERS,
  MEDIUMS,
  normalizeBdPhone,
  useAdmissionSettings,
  useClassOfferings,
  useDocumentTypes,
  type AcademicYear,
  type ApplicationStatus,
  type Gender,
  type Medium,
} from '@/lib/academics';
import { invokeFunction } from '@/lib/functions';
import { TURNSTILE_SITE_KEY, Turnstile } from '@/components/Turnstile';
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage';
import { Card, PageHeader, Section, Spinner, buttonClass, cx, inputClass } from '@/components/ui';
import { ApplicationStatusBadge, useMediumLabel } from '@/components/admissions';
import { QueryView } from '@/components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Values = {
  academic_year_id: string;
  medium: Medium | '';
  class_id: string;
  student_name_en: string;
  student_name_bn: string;
  date_of_birth: string;
  gender: Gender | '';
  previous_school: string;
  guardian_name: string;
  guardian_relationship: string;
  guardian_phone: string;
  guardian_email: string;
  present_address: string;
  permanent_address: string;
};

const EMPTY: Values = {
  academic_year_id: '',
  medium: '',
  class_id: '',
  student_name_en: '',
  student_name_bn: '',
  date_of_birth: '',
  gender: '',
  previous_school: '',
  guardian_name: '',
  guardian_relationship: '',
  guardian_phone: '',
  guardian_email: '',
  present_address: '',
  permanent_address: '',
};

function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-navy-800">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm sm:p-7">
      <legend className="heading -ml-1 px-1 text-lg font-bold text-navy-900">{title}</legend>
      <div className="mt-2 grid gap-5 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function AdmissionApplyPage() {
  const { t, pick } = useLang();
  const a = t.apply;
  usePageMeta(a.title, a.subtitle);
  const mediumLabel = useMediumLabel();

  const settings = useAdmissionSettings();
  const offerings = useClassOfferings();
  const docTypes = useDocumentTypes();
  const years = useQuery<AcademicYear[]>(
    (db) => db.from('academic_years').select('*').eq('admission_open', true).order('starts_on'),
    [],
  );

  const [values, setValues] = useState<Values>(EMPTY);
  const [sameAddress, setSameAddress] = useState(false);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const classesForMedium = useMemo(() => {
    if (offerings.state.status !== 'ready' || !values.medium) return [];
    return offerings.state.data.filter((c) => c.class_streams.some((s) => s.medium === values.medium && s.admission_open));
  }, [offerings.state, values.medium]);

  const states = [settings.state, offerings.state, docTypes.state, years.state];
  const crumbs = [{ to: '/admissions', label: t.nav.admissions }];

  if (states.some((s) => s.status === 'loading')) {
    return (
      <>
        <PageHeader title={a.title} subtitle={a.subtitle} crumbs={crumbs} />
        <Spinner />
      </>
    );
  }
  const notReady = states.find((s) => s.status === 'unconfigured' || s.status === 'error');
  if (notReady) {
    return (
      <>
        <PageHeader title={a.title} subtitle={a.subtitle} crumbs={crumbs} />
        <Section>
          <QueryView state={notReady} retry={() => window.location.reload()} empty="">
            {() => null}
          </QueryView>
        </Section>
      </>
    );
  }

  const s = settings.state.status === 'ready' ? settings.state.data : null;
  const openYears = years.state.status === 'ready' ? years.state.data : [];
  const types = docTypes.state.status === 'ready' ? docTypes.state.data : [];

  if (!s?.is_open || openYears.length === 0) {
    return (
      <>
        <PageHeader title={a.title} subtitle={a.subtitle} crumbs={crumbs} />
        <Section>
          <Card className="mx-auto max-w-xl text-center">
            <Lock className="mx-auto h-10 w-10 text-gold-500" aria-hidden />
            <h2 className="heading mt-4 text-xl font-bold text-navy-900">{t.admissions.closedTitle}</h2>
            <p className="mt-2 text-slate-600">{t.admissions.closedBody}</p>
            <Link to="/notices?category=admission" className={buttonClass('primary', 'mt-6')}>
              {t.home.admissionCta}
            </Link>
          </Card>
        </Section>
      </>
    );
  }

  if (reference) {
    return (
      <>
        <PageHeader title={a.successTitle} crumbs={crumbs} />
        <Section>
          <Card className="mx-auto max-w-xl p-8 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" aria-hidden />
            <h2 className="heading mt-4 text-2xl font-bold text-navy-900">{a.successTitle}</h2>
            <p className="mt-2 text-slate-600">{a.successBody}</p>
            <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">{a.referenceLabel}</p>
            <p className="mt-1 select-all font-mono text-3xl font-bold tracking-wider text-royal-700">{reference}</p>
            <p className="mx-auto mt-4 max-w-md rounded-lg bg-gold-100/70 p-3 text-sm text-navy-900">{a.saveReference}</p>
            <div className="no-print mt-8 flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => window.print()} className={buttonClass('primary')}>
                <Printer className="h-4 w-4" aria-hidden />
                {t.common.print}
              </button>
              <Link to="/admissions/status" className={buttonClass('outline')}>
                {t.admissions.checkStatus}
              </Link>
              <button
                type="button"
                className={buttonClass('ghost')}
                onClick={() => {
                  setReference(null);
                  setValues(EMPTY);
                  setFiles({});
                  setConsent(false);
                  setSameAddress(false);
                }}
              >
                {a.anotherApplication}
              </button>
            </div>
          </Card>
        </Section>
      </>
    );
  }

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      if (key === 'medium') next.class_id = '';
      if (key === 'present_address' && sameAddress) next.permanent_address = value as string;
      return next;
    });
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    const req = a.errors.required;
    const v = values;
    (['academic_year_id', 'medium', 'class_id', 'student_name_en', 'date_of_birth', 'guardian_name', 'guardian_relationship', 'present_address'] as const).forEach(
      (k) => {
        if (!String(v[k]).trim()) e[k] = req;
      },
    );
    if (!sameAddress && !v.permanent_address.trim()) e.permanent_address = req;
    if (s.require_gender && !v.gender) e.gender = req;
    if (s.require_previous_school && !v.previous_school.trim()) e.previous_school = req;
    if (!normalizeBdPhone(v.guardian_phone)) e.guardian_phone = a.errors.phone;
    if (v.guardian_email.trim() ? !EMAIL_RE.test(v.guardian_email.trim()) : s.require_guardian_email) {
      e.guardian_email = v.guardian_email.trim() ? a.errors.email : req;
    }
    if (v.date_of_birth) {
      const dob = new Date(v.date_of_birth + 'T00:00:00');
      const now = new Date();
      const years = (now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (Number.isNaN(years) || years < 2 || years > 30) e.date_of_birth = a.errors.dob;
    }
    for (const dt of types) if (dt.is_required && !files[dt.id]) e[`doc:${dt.id}`] = a.errors.file;
    if (!consent) e.consent = a.errors.consent;
    return e;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const e = validate();
    setErrors(e);
    const firstError = Object.keys(e).find((k) => e[k]);
    if (firstError) {
      setServerError(a.fixErrors);
      document.getElementById(`f-${firstError}`)?.focus();
      return;
    }
    const form = new FormData();
    form.append(
      'application',
      JSON.stringify({
        ...values,
        permanent_address: sameAddress ? values.present_address : values.permanent_address,
      }),
    );
    for (const [typeId, file] of Object.entries(files)) form.append(`doc:${typeId}`, file);
    if (TURNSTILE_SITE_KEY) {
      if (!captchaToken) return setServerError(a.captchaNeeded);
      form.append('captcha_token', captchaToken);
    }

    setSubmitting(true);
    const result = await invokeFunction<{ reference_no: string }>('submit-application', form);
    setSubmitting(false);
    if (result.ok) {
      setReference(result.data.reference_no);
      window.scrollTo(0, 0);
    } else {
      setServerError(a.serverErrors[result.code] ?? a.serverErrors.generic);
      // A Turnstile token is single-use: get a fresh one for the next attempt.
      setCaptchaReset((n) => n + 1);
    }
  };

  const inputProps = (key: keyof Values) => ({
    id: `f-${key}`,
    value: values[key],
    'aria-invalid': Boolean(errors[key]),
    'aria-describedby': errors[key] ? `f-${key}-error` : undefined,
    className: cx(inputClass, errors[key] && 'border-red-400'),
  });

  return (
    <>
      <PageHeader title={a.title} subtitle={a.subtitle} crumbs={crumbs} />
      <Section>
        <form onSubmit={onSubmit} noValidate className="mx-auto max-w-4xl space-y-6">
          {pick(s.instructions_en, s.instructions_bn) && (
            <div className="rounded-xl border border-royal-100 bg-royal-50/60 p-5 text-sm text-slate-700">
              <p className="mb-1 font-semibold text-navy-900">{t.admissions.instructionsTitle}</p>
              <p className="whitespace-pre-line">{pick(s.instructions_en, s.instructions_bn)}</p>
            </div>
          )}

          <FormSection title={a.sections.programme}>
            <Field id="f-academic_year_id" label={a.fields.academic_year} required error={errors.academic_year_id}>
              <select {...inputProps('academic_year_id')} onChange={(e) => set('academic_year_id', e.target.value)}>
                <option value="">{a.select}</option>
                {openYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {pick(y.name_en, y.name_bn)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="f-medium" label={a.fields.medium} required error={errors.medium} hint={a.mediumHint}>
              <select
                {...inputProps('medium')}
                aria-describedby={errors.medium ? 'f-medium-error' : 'f-medium-hint'}
                onChange={(e) => set('medium', e.target.value as Medium | '')}
              >
                <option value="">{a.select}</option>
                {MEDIUMS.map((m) => (
                  <option key={m} value={m}>
                    {mediumLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="f-class_id"
              label={a.fields.class}
              required
              error={errors.class_id}
              hint={values.medium && classesForMedium.length === 0 ? a.noClasses : undefined}
              className="md:col-span-2"
            >
              <select {...inputProps('class_id')} disabled={!values.medium} onChange={(e) => set('class_id', e.target.value)}>
                <option value="">{values.medium ? a.select : a.selectMediumFirst}</option>
                {classesForMedium.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(c.name_en, c.name_bn)}
                  </option>
                ))}
              </select>
            </Field>
          </FormSection>

          <FormSection title={a.sections.student}>
            <Field id="f-student_name_en" label={a.fields.student_name_en} required error={errors.student_name_en}>
              <input {...inputProps('student_name_en')} lang="en" autoComplete="off" maxLength={150} onChange={(e) => set('student_name_en', e.target.value)} />
            </Field>
            <Field id="f-student_name_bn" label={a.fields.student_name_bn}>
              <input {...inputProps('student_name_bn')} lang="bn" autoComplete="off" maxLength={150} onChange={(e) => set('student_name_bn', e.target.value)} />
            </Field>
            <Field id="f-date_of_birth" label={a.fields.date_of_birth} required error={errors.date_of_birth}>
              <input {...inputProps('date_of_birth')} type="date" max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('date_of_birth', e.target.value)} />
            </Field>
            <Field id="f-gender" label={a.fields.gender} required={s.require_gender} error={errors.gender}>
              <select {...inputProps('gender')} onChange={(e) => set('gender', e.target.value as Gender | '')}>
                <option value="">{a.select}</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {t.genders[g]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="f-previous_school"
              label={`${a.fields.previous_school}${s.require_previous_school ? '' : ` (${a.optional})`}`}
              required={s.require_previous_school}
              error={errors.previous_school}
              className="md:col-span-2"
            >
              <input {...inputProps('previous_school')} maxLength={200} onChange={(e) => set('previous_school', e.target.value)} />
            </Field>
          </FormSection>

          <FormSection title={a.sections.guardian}>
            <Field id="f-guardian_name" label={a.fields.guardian_name} required error={errors.guardian_name}>
              <input {...inputProps('guardian_name')} autoComplete="name" maxLength={150} onChange={(e) => set('guardian_name', e.target.value)} />
            </Field>
            <Field id="f-guardian_relationship" label={a.fields.guardian_relationship} required error={errors.guardian_relationship}>
              <input {...inputProps('guardian_relationship')} list="relationship-options" maxLength={50} onChange={(e) => set('guardian_relationship', e.target.value)} />
              <datalist id="relationship-options">
                {a.relationshipSuggestions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field id="f-guardian_phone" label={a.fields.guardian_phone} required error={errors.guardian_phone} hint={a.phoneHint}>
              <input {...inputProps('guardian_phone')} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} onChange={(e) => set('guardian_phone', e.target.value)} />
            </Field>
            <Field
              id="f-guardian_email"
              label={`${a.fields.guardian_email}${s.require_guardian_email ? '' : ` (${a.optional})`}`}
              required={s.require_guardian_email}
              error={errors.guardian_email}
            >
              <input {...inputProps('guardian_email')} type="email" autoComplete="email" maxLength={254} onChange={(e) => set('guardian_email', e.target.value)} />
            </Field>
          </FormSection>

          <FormSection title={a.sections.address}>
            <Field id="f-present_address" label={a.fields.present_address} required error={errors.present_address} className="md:col-span-2">
              <textarea {...inputProps('present_address')} rows={3} maxLength={500} onChange={(e) => set('present_address', e.target.value)} />
            </Field>
            <div className="md:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-navy-800">
                <input
                  type="checkbox"
                  checked={sameAddress}
                  onChange={(e) => {
                    setSameAddress(e.target.checked);
                    if (e.target.checked) set('permanent_address', values.present_address);
                  }}
                  className="h-4 w-4 rounded border-navy-300 text-royal-600"
                />
                {a.fields.sameAddress}
              </label>
            </div>
            {!sameAddress && (
              <Field id="f-permanent_address" label={a.fields.permanent_address} required error={errors.permanent_address} className="md:col-span-2">
                <textarea {...inputProps('permanent_address')} rows={3} maxLength={500} onChange={(e) => set('permanent_address', e.target.value)} />
              </Field>
            )}
          </FormSection>

          {types.length > 0 && (
            <fieldset className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm sm:p-7">
              <legend className="heading -ml-1 px-1 text-lg font-bold text-navy-900">{a.sections.documents}</legend>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                <Lock className="h-4 w-4 text-royal-600" aria-hidden />
                {a.fileHint}
              </p>
              <ul className="mt-4 divide-y divide-navy-100">
                {types.map((dt) => {
                  const key = `doc:${dt.id}`;
                  const file = files[dt.id];
                  return (
                    <li key={dt.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-navy-900">
                          {pick(dt.name_en, dt.name_bn)}{' '}
                          <span className={cx('ml-1 rounded-full px-2 py-0.5 text-xs font-semibold', dt.is_required ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600')}>
                            {dt.is_required ? a.required : a.optional}
                          </span>
                        </p>
                        {pick(dt.description_en, dt.description_bn) && (
                          <p className="text-sm text-slate-500">{pick(dt.description_en, dt.description_bn)}</p>
                        )}
                        {file && (
                          <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700">
                            <FileCheck2 className="h-4 w-4" aria-hidden />
                            <span className="truncate">{file.name}</span>
                          </p>
                        )}
                        {errors[key] && (
                          <p id={`f-${key}-error`} className="mt-1 text-xs font-medium text-red-600">
                            {errors[key]}
                          </p>
                        )}
                      </div>
                      <label htmlFor={`f-${key}`} className={cx(buttonClass('outline'), 'shrink-0 cursor-pointer')}>
                        <Paperclip className="h-4 w-4" aria-hidden />
                        {file ? a.changeFile : a.chooseFile}
                      </label>
                      <input
                        id={`f-${key}`}
                        type="file"
                        accept={DOCUMENT_TYPES.join(',')}
                        className="sr-only"
                        aria-describedby={errors[key] ? `f-${key}-error` : undefined}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          if (!DOCUMENT_TYPES.includes(f.type)) return setErrors((x) => ({ ...x, [key]: a.errors.fileType }));
                          if (f.size > MAX_UPLOAD_BYTES) return setErrors((x) => ({ ...x, [key]: a.errors.fileSize }));
                          setFiles((x) => ({ ...x, [dt.id]: f }));
                          setErrors((x) => ({ ...x, [key]: '' }));
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <fieldset className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm sm:p-7">
            <legend className="heading -ml-1 px-1 text-lg font-bold text-navy-900">{a.sections.declaration}</legend>
            <label className="mt-2 flex items-start gap-3 text-sm text-slate-700">
              <input
                id="f-consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  setErrors((x) => ({ ...x, consent: '' }));
                }}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-navy-300 text-royal-600"
              />
              <span>
                {a.consent}{' '}
                <Link to="/privacy" target="_blank" className="font-semibold text-royal-700 underline">
                  {t.nav.privacy}
                </Link>
              </span>
            </label>
            {errors.consent && <p className="mt-2 text-xs font-medium text-red-600">{errors.consent}</p>}
          </fieldset>

          <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />

          {serverError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
              {serverError}
            </div>
          )}

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
            {submitting && <p className="text-sm text-slate-600">{a.submitting}</p>}
            <button type="submit" disabled={submitting} className={buttonClass('gold', 'px-8 py-3 text-base')}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {a.submit}
            </button>
          </div>
        </form>
      </Section>
    </>
  );
}

interface LookupResult {
  reference_no: string;
  status: ApplicationStatus;
  status_note: string | null;
  submitted_at: string;
  medium: Medium;
  class_name_en: string;
  class_name_bn: string | null;
  year_name_en: string;
  year_name_bn: string | null;
}

export function AdmissionStatusPage() {
  const { t, pick, formatDate } = useLang();
  const sc = t.statusCheck;
  usePageMeta(sc.title, sc.subtitle, { noindex: true });
  const mediumLabel = useMediumLabel();
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!reference.trim() || !phone.trim() || !dob) return setError(t.apply.errors.required);
    if (!supabase) return setError(t.common.backendBody);
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('lookup_admission_status', {
      p_reference: reference.trim(),
      p_phone: phone.trim(),
      p_dob: dob,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message === 'TOO_MANY_ATTEMPTS' ? sc.tooMany : t.common.errorBody);
    if (!data) return setError(sc.notFound);
    setResult(data as LookupResult);
  };

  return (
    <>
      <PageHeader title={sc.title} subtitle={sc.subtitle} crumbs={[{ to: '/admissions', label: t.nav.admissions }]} />
      <Section>
        <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
          <Card>
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="s-ref" className="mb-1.5 block text-sm font-semibold text-navy-800">
                  {sc.reference}
                </label>
                <input
                  id="s-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.toUpperCase())}
                  placeholder="KI-APP-2027-00001"
                  autoComplete="off"
                  maxLength={30}
                  className={inputClass + ' font-mono'}
                />
              </div>
              <div>
                <label htmlFor="s-phone" className="mb-1.5 block text-sm font-semibold text-navy-800">
                  {sc.phone}
                </label>
                <input id="s-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} className={inputClass} />
              </div>
              <div>
                <label htmlFor="s-dob" className="mb-1.5 block text-sm font-semibold text-navy-800">
                  {sc.dob}
                </label>
                <input id="s-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputClass} />
              </div>
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className={buttonClass('primary', 'w-full py-3')}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                {busy ? sc.checking : sc.check}
              </button>
            </form>
          </Card>

          {result ? (
            <Card>
              <p role="status" className="text-sm font-semibold uppercase tracking-wide text-slate-500">{sc.resultTitle}</p>
              <p className="mt-1 font-mono text-xl font-bold text-royal-700">{result.reference_no}</p>
              <div className="mt-4">
                <ApplicationStatusBadge status={result.status} large />
              </div>
              <p className="mt-3 text-slate-700">{sc.help[result.status]}</p>
              {result.status_note && (
                <div className="mt-4 rounded-lg border border-gold-300 bg-gold-100/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gold-600">{sc.message}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-navy-900">{result.status_note}</p>
                </div>
              )}
              <dl className="mt-5 divide-y divide-navy-100 text-sm">
                {[
                  [sc.year, pick(result.year_name_en, result.year_name_bn)],
                  [sc.classLabel, pick(result.class_name_en, result.class_name_bn)],
                  [sc.medium, mediumLabel(result.medium)],
                  [sc.submittedOn, formatDate(result.submitted_at)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-medium text-navy-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <div className="hidden items-center justify-center rounded-2xl border-2 border-dashed border-navy-100 p-8 text-center text-sm text-slate-500 lg:flex">
              <Search className="mr-2 h-5 w-5" aria-hidden />
              {sc.subtitle}
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
