import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { buttonClass } from '@/components/ui';
import { Modal, SelectField, TextAreaField, TextField } from './adminUi';

export type EntityValue = string | boolean;
export type EntityValues = Record<string, EntityValue>;

export interface EntityField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'checkbox' | 'select';
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  lang?: 'bn' | 'en';
  wide?: boolean;
}

/** Converts form values to a database payload: '' becomes null, numbers are parsed. */
export function toEntityPayload(fields: EntityField[], values: EntityValues) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'checkbox') out[f.name] = Boolean(v);
    else if (f.type === 'number') out[f.name] = v === '' || v === undefined ? null : Number(v);
    else out[f.name] = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }
  return out;
}

/** Maps Postgres error codes to the admin messages used across the academic pages. */
export function entityErrorMessage(code: string | undefined, t: { duplicate: string; inUse: string; invalid: string }) {
  if (code === '23505') return t.duplicate;
  if (code === '23503') return t.inUse;
  return t.invalid;
}

export function EntityModal({
  open,
  title,
  fields,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  fields: EntityField[];
  initial: EntityValues;
  onClose: () => void;
  /** Return an error message to keep the dialog open, or null on success. */
  onSubmit: (values: EntityValues) => Promise<string | null>;
}) {
  const { t } = useLang();
  const [values, setValues] = useState<EntityValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(initial);
      setErrors({});
      setFormError(null);
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (name: string, value: EntityValue) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => ({ ...e, [name]: '' }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === 'checkbox') continue;
      const s = typeof v === 'string' ? v.trim() : '';
      if (f.required && !s) errs[f.name] = t.admin.common.required;
      else if (s && f.maxLength && s.length > f.maxLength) errs[f.name] = t.admin.common.tooLong(f.maxLength);
      else if (s && f.pattern && !f.pattern.test(s)) errs[f.name] = f.patternMessage ?? t.admin.academics.invalid;
    }
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    const message = await onSubmit(values);
    setBusy(false);
    if (message) setFormError(message);
  };

  return (
    <Modal open={open} title={title} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const common = {
            label: f.label,
            error: errors[f.name],
            hint: f.hint,
            required: f.required,
            className: f.wide || f.type === 'textarea' ? 'sm:col-span-2' : undefined,
            lang: f.lang,
          };
          const value = values[f.name];
          switch (f.type) {
            case 'checkbox':
              return (
                <label key={f.name} className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-navy-800">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => set(f.name, e.target.checked)}
                    className="h-4 w-4 rounded border-navy-300 text-royal-600"
                  />
                  {f.label}
                </label>
              );
            case 'select':
              return (
                <SelectField
                  key={f.name}
                  {...common}
                  value={String(value ?? '')}
                  options={f.options ?? []}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              );
            case 'textarea':
              return <TextAreaField key={f.name} {...common} rows={3} value={String(value ?? '')} onChange={(e) => set(f.name, e.target.value)} />;
            default:
              return (
                <TextField
                  key={f.name}
                  {...common}
                  type={f.type}
                  value={String(value ?? '')}
                  maxLength={f.maxLength}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              );
          }
        })}
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2 sm:col-span-2">
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass('outline')}>
            {t.admin.common.cancel}
          </button>
          <button type="submit" disabled={busy} className={buttonClass('primary')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t.admin.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
