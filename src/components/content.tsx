import { Link } from 'react-router-dom';
import { CalendarDays, FileText, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { toBnDigits, toInternational } from '@/lib/institution';
import type { Notice, SchoolEvent } from '@/lib/content';
import type { ClassWithStreams, Medium } from '@/lib/academics';
import { Card } from '@/components/ui';

export function NoticeRow({ notice }: { notice: Notice }) {
  const { t, pick, formatDate } = useLang();
  return (
    <li>
      <Link
        to={`/notices/${notice.id}`}
        className="group flex gap-4 rounded-xl border border-navy-100 bg-white p-4 transition hover:border-royal-200 hover:shadow-md"
      >
        <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-royal-50 text-royal-700 sm:flex">
          <FileText className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-900 group-hover:text-royal-700">{pick(notice.title_en, notice.title_bn)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="rounded-full bg-gold-100 px-2 py-0.5 font-semibold text-gold-600">
              {t.noticeCategories[notice.category]}
            </span>
            <time dateTime={notice.publish_at}>{formatDate(notice.publish_at)}</time>
          </p>
        </div>
      </Link>
    </li>
  );
}

export function EventCard({ event }: { event: SchoolEvent }) {
  const { t, pick, formatDate } = useLang();
  const start = new Date(event.starts_on + 'T00:00:00');
  return (
    <Card className="flex gap-4 p-5">
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-navy-900 text-white">
        <span className="text-xl font-bold leading-none">{formatDate(start, { day: 'numeric' })}</span>
        <span className="mt-1 text-xs uppercase text-gold-300">{formatDate(start, { month: 'short' })}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-royal-600">{t.eventTypes[event.event_type]}</p>
        <h3 className="mt-0.5 font-semibold text-navy-900">{pick(event.title_en, event.title_bn)}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {formatDate(start)}
            {event.ends_on && event.ends_on !== event.starts_on && ` – ${formatDate(event.ends_on + 'T00:00:00')}`}
          </span>
          {event.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {event.location}
            </span>
          )}
        </p>
        {pick(event.description_en, event.description_bn) && (
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-slate-600">
            {pick(event.description_en, event.description_bn)}
          </p>
        )}
      </div>
    </Card>
  );
}

export function ContactCards() {
  const { t, lang, pick } = useLang();
  const inst = useInstitution();
  const phone = lang === 'bn' ? toBnDigits(inst.phone) : inst.phone;
  const items = [
    { icon: MapPin, label: t.common.address, value: pick(inst.address_en, inst.address_bn), href: undefined },
    { icon: Phone, label: t.common.phone, value: phone, href: `tel:+${toInternational(inst.phone)}` },
    ...(inst.whatsapp
      ? [
          {
            icon: MessageCircle,
            label: t.common.whatsapp,
            value: lang === 'bn' ? toBnDigits(inst.whatsapp) : inst.whatsapp,
            href: `https://wa.me/${toInternational(inst.whatsapp)}`,
          },
        ]
      : []),
    { icon: Mail, label: t.common.email, value: inst.email, href: `mailto:${inst.email}` },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map(({ icon: Icon, label, value, href }) => (
        <li key={label}>
          <Card className="flex h-full gap-4 p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold-100 text-gold-600">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              {href ? (
                <a
                  href={href}
                  className="mt-0.5 block break-words font-semibold text-navy-900 hover:text-royal-700"
                  {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {value}
                </a>
              ) : (
                <p className="mt-0.5 font-semibold text-navy-900">{value}</p>
              )}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** Classes offered in a stream (from the academic setup), as chips. Null when none are configured. */
export function StreamClassChips({ classes, medium }: { classes: ClassWithStreams[]; medium: Medium }) {
  const { pick } = useLang();
  const offered = classes.filter((c) => c.class_streams.some((s) => s.medium === medium));
  if (!offered.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {offered.map((c) => (
        <li key={c.id} className="rounded-full border border-navy-100 bg-navy-50/70 px-3 py-1 text-sm font-medium text-navy-800">
          {pick(c.name_en, c.name_bn)}
        </li>
      ))}
    </ul>
  );
}

export function StreamIcon({ stream }: { stream: 'bangla_medium' | 'english_version' }) {
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-royal-500 to-navy-800 text-lg font-bold text-white"
      lang={stream === 'bangla_medium' ? 'bn' : 'en'}
    >
      {stream === 'bangla_medium' ? 'অ' : 'Aa'}
    </span>
  );
}
