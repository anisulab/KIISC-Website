import { useLang } from '@/i18n/LanguageProvider';
import type { ApplicationStatus, Medium } from '@/lib/academics';
import { cx } from '@/components/ui';

const TONES: Record<ApplicationStatus, string> = {
  submitted: 'bg-royal-50 text-royal-700',
  under_review: 'bg-gold-100 text-gold-600',
  info_required: 'bg-orange-100 text-orange-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
  admitted: 'bg-navy-900 text-white',
  withdrawn: 'bg-slate-100 text-slate-600',
};

export function ApplicationStatusBadge({ status, large = false }: { status: ApplicationStatus; large?: boolean }) {
  const { t } = useLang();
  return (
    <span
      className={cx(
        'inline-block whitespace-nowrap rounded-full font-semibold',
        large ? 'px-4 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs',
        TONES[status],
      )}
    >
      {t.applicationStatuses[status]}
    </span>
  );
}

export function useMediumLabel() {
  const { t } = useLang();
  return (m: Medium) => (m === 'bangla_medium' ? t.nav.banglaMedium : t.nav.englishVersion);
}
