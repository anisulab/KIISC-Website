import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, DatabaseZap, Inbox, Info, Loader2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import type { QueryState } from '@/hooks/useQuery';
import { useInstitutionContext } from '@/hooks/useInstitution';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
}

export function Section({
  children,
  className,
  tone = 'white',
  id,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'white' | 'tint' | 'navy';
  id?: string;
}) {
  const tones = {
    white: 'bg-white',
    tint: 'bg-navy-50/60',
    navy: 'bg-navy-900 text-white',
  };
  return (
    <section id={id} className={cx('py-14 sm:py-20', tones[tone], className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  title,
  intro,
  action,
  light,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
  light?: boolean;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <span className="mb-3 block h-1 w-12 rounded-full bg-gold-500" aria-hidden />
        <h2 className={cx('heading text-2xl font-bold sm:text-3xl', light ? 'text-white' : 'text-navy-900')}>
          {title}
        </h2>
        {intro && <p className={cx('mt-3 text-base', light ? 'text-navy-100' : 'text-slate-600')}>{intro}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, crumbs = [] }: { title: string; subtitle?: string; crumbs?: { to: string; label: string }[] }) {
  const { t } = useLang();
  return (
    <div className="hero-pattern relative overflow-hidden bg-navy-900 text-white">
      <Container className="relative py-12 sm:py-16">
        <nav aria-label="Breadcrumb" className="no-print mb-4 text-sm text-navy-200">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link to="/" className="hover:text-white">
                {t.nav.home}
              </Link>
            </li>
            {crumbs.map((c) => (
              <li key={c.to} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                <Link to={c.to} className="hover:text-white">
                  {c.label}
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              <span aria-current="page" className="text-gold-300">
                {title}
              </span>
            </li>
          </ol>
        </nav>
        <h1 className="heading text-3xl font-bold sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-lg text-navy-100">{subtitle}</p>}
      </Container>
      <div className="h-1 bg-gradient-to-r from-gold-500 via-gold-300 to-transparent" aria-hidden />
    </div>
  );
}

type ButtonVariant = 'primary' | 'gold' | 'outline' | 'outlineLight' | 'ghost';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-royal-600 text-white hover:bg-royal-700 shadow-sm',
  gold: 'bg-gold-500 text-navy-950 hover:bg-gold-400 shadow-sm',
  outline: 'border border-navy-200 bg-white text-navy-800 hover:border-royal-500 hover:text-royal-700',
  outlineLight: 'border border-white/40 text-white hover:bg-white/10',
  ghost: 'text-royal-700 hover:bg-royal-50',
};

export const buttonClass = (variant: ButtonVariant = 'primary', extra?: string) =>
  cx(
    'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 disabled:cursor-not-allowed disabled:opacity-60',
    buttonStyles[variant],
    extra,
  );

export function ButtonLink({
  to,
  children,
  variant = 'primary',
  className,
}: {
  to: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Link to={to} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-2xl border border-navy-100 bg-white p-6 shadow-sm', className)}>{children}</div>
  );
}

/** Clearly labelled slot for information the institution has not yet supplied. */
export function Placeholder({ label, note }: { label?: string; note?: string }) {
  const { t } = useLang();
  return (
    <div className="rounded-xl border-2 border-dashed border-gold-400/70 bg-gold-100/40 p-4 text-sm text-navy-800">
      <p className="flex items-center gap-2 font-semibold">
        <Info className="h-4 w-4 text-gold-600" aria-hidden />
        {label ? `${label}: ` : ''}
        <span className="text-gold-600">{t.common.toBeConfirmed}</span>
      </p>
      <p className="mt-1 text-slate-600">{note ?? t.common.placeholderNote}</p>
    </div>
  );
}

export function DraftBadge() {
  const { t } = useLang();
  return (
    <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-gold-100 px-3 py-1 text-xs font-semibold text-gold-600">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      {t.common.draftBadge}
    </p>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useLang();
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-10 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin text-royal-600" aria-hidden />
      <span>{label ?? t.common.loading}</span>
    </div>
  );
}

function Notice({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-navy-100 bg-white px-6 py-10 text-center">
      <div className="mb-3 rounded-full bg-navy-50 p-3 text-navy-700">{icon}</div>
      <p className="font-semibold text-navy-900">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-slate-600">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <Notice icon={<Inbox className="h-6 w-6" aria-hidden />} title={message} />;
}

/**
 * Renders loading / error / not-connected / empty states for a query and
 * calls `children` only when there is data to show.
 */
export function QueryView<T>({
  state,
  retry,
  empty,
  isEmpty = (d) => Array.isArray(d) && d.length === 0,
  children,
}: {
  state: QueryState<T>;
  retry: () => void;
  empty: string;
  isEmpty?: (data: T) => boolean;
  children: (data: T, count: number | null) => ReactNode;
}) {
  const { t } = useLang();
  switch (state.status) {
    case 'unconfigured':
      return <Notice icon={<DatabaseZap className="h-6 w-6" aria-hidden />} title={t.common.backendTitle} body={t.common.backendBody} />;
    case 'loading':
      return <Spinner />;
    case 'error':
      return (
        <div role="alert">
          <Notice
            icon={<AlertTriangle className="h-6 w-6 text-red-600" aria-hidden />}
            title={t.common.errorTitle}
            body={t.common.errorBody}
            action={
              <button type="button" onClick={retry} className={buttonClass('outline')}>
                {t.common.retry}
              </button>
            }
          />
        </div>
      );
    case 'ready':
      return isEmpty(state.data) ? <EmptyState message={empty} /> : <>{children(state.data, state.count)}</>;
  }
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const { t } = useLang();
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="no-print mt-8 flex items-center justify-between gap-4">
      <button
        type="button"
        className={buttonClass('outline')}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t.common.previous}
      </button>
      <span className="text-sm text-slate-600">{t.common.pageOf(page, totalPages)}</span>
      <button
        type="button"
        className={buttonClass('outline')}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        {t.common.next}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}

/** The uploaded logo from institution settings, or a placeholder crest until one is supplied. */
export function Logo({ className }: { className?: string }) {
  const { t } = useLang();
  const { logoUrl } = useInstitutionContext();
  if (logoUrl) return <img src={logoUrl} alt="" className={cx('object-contain', className)} />;
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={t.footer.logoPlaceholder}>
      <path d="M32 3 8 11v19c0 15 10 26 24 31 14-5 24-16 24-31V11L32 3z" fill="#0e1a3d" />
      <path
        d="M32 8 13 14.5V30c0 12 8 21 19 25.5C43 51 51 42 51 30V14.5L32 8z"
        fill="none"
        stroke="#c49a3a"
        strokeWidth="2"
      />
      <text x="32" y="38" textAnchor="middle" fontFamily="Poppins, Arial, sans-serif" fontWeight="700" fontSize="17" fill="#fff">
        KI
      </text>
    </svg>
  );
}

export const inputClass =
  'w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 placeholder:text-slate-400 focus:border-royal-500 focus:outline-none focus:ring-2 focus:ring-royal-200';
