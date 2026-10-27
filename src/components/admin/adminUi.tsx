import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { buttonClass, cx, inputClass } from '@/components/ui';

// ---------- Toasts ----------------------------------------------------
type Toast = { id: number; tone: 'success' | 'error'; message: string };
const ToastContext = createContext<(tone: Toast['tone'], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, tone, message }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[70] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'flex items-start gap-3 rounded-xl border p-4 text-sm shadow-lg',
              toast.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900',
            )}
          >
            {toast.tone === 'success' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            ) : (
              <XCircle className="h-5 w-5 shrink-0" aria-hidden />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== toast.id))}
              className="opacity-60 hover:opacity-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------- Confirmation dialog ----------------------------------------
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/60" onClick={() => !busy && onCancel()} aria-hidden />
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex gap-4">
          <div className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', danger ? 'bg-red-100 text-red-600' : 'bg-royal-50 text-royal-600')}>
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-navy-900">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={buttonClass('outline')}>
            {t.admin.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cx(buttonClass('primary'), danger && 'bg-red-600 hover:bg-red-700')}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Modal (generic) ---------------------------------------------
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="heading text-lg font-bold text-navy-900">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-500 hover:bg-navy-50">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Form fields -------------------------------------------------
interface FieldShellProps {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}

export function FieldShell({ label, error, hint, required, children, className }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-navy-800">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children(id, describedBy)}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

const errorRing = 'border-red-400 focus:border-red-500 focus:ring-red-200';

type BaseFieldProps = { label: string; error?: string | null; hint?: string; className?: string };

export function TextField({ label, error, hint, className, ...props }: BaseFieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={props.required} className={className}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
          className={cx(inputClass, error && errorRing, props.disabled && 'bg-slate-50 text-slate-500')}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({ label, error, hint, className, ...props }: BaseFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={props.required} className={className}>
      {(id, describedBy) => (
        <textarea
          id={id}
          rows={5}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
          className={cx(inputClass, 'min-h-[7rem]', error && errorRing, props.disabled && 'bg-slate-50 text-slate-500')}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  className,
  options,
  ...props
}: BaseFieldProps & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={props.required} className={className}>
      {(id, describedBy) => (
        <select id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} className={cx(inputClass, error && errorRing)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

// ---------- Display helpers ----------------------------------------------
export function StatusBadge({ status }: { status: 'draft' | 'published' | 'archived' }) {
  const { t } = useLang();
  const tones = {
    draft: 'bg-slate-100 text-slate-700',
    published: 'bg-emerald-100 text-emerald-800',
    archived: 'bg-gold-100 text-gold-600',
  };
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[status])}>{t.admin.statuses[status]}</span>;
}

export function AdminPageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="heading text-2xl font-bold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6', className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-navy-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function InlineNotice({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'flex gap-2 rounded-lg p-3 text-sm',
        tone === 'warning' ? 'border border-gold-300 bg-gold-100/60 text-navy-900' : 'bg-royal-50 text-navy-800',
      )}
    >
      <AlertTriangle className={cx('mt-0.5 h-4 w-4 shrink-0', tone === 'warning' ? 'text-gold-600' : 'text-royal-600')} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Converts between ISO timestamps and the value format of <input type="datetime-local">. */
export function isoToLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}
