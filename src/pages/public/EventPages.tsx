import { useMemo, useState } from 'react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { EVENT_TYPES, type EventType, type SchoolEvent, todayIso } from '@/lib/content';
import { PageHeader, Pagination, QueryView, Section, cx, inputClass } from '@/components/ui';
import { EventCard } from '@/components/content';
import { toBnDigits } from '@/lib/institution';

const EVENT_COLUMNS = 'id,title_en,title_bn,description_en,description_bn,event_type,starts_on,ends_on,location';
const PAGE_SIZE = 9;

export function EventsPage() {
  const { t } = useLang();
  usePageMeta(t.events.title, t.events.subtitle);
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [page, setPage] = useState(1);

  const { state, retry } = useQuery<SchoolEvent[]>(
    (db) => {
      const today = todayIso();
      const from = (page - 1) * PAGE_SIZE;
      let query = db.from('events').select(EVENT_COLUMNS, { count: 'exact' }).eq('status', 'published');
      query =
        when === 'upcoming'
          ? query.gte('starts_on', today).order('starts_on', { ascending: true })
          : query.lt('starts_on', today).order('starts_on', { ascending: false });
      return query.range(from, from + PAGE_SIZE - 1);
    },
    [when, page],
  );

  return (
    <>
      <PageHeader title={t.events.title} subtitle={t.events.subtitle} />
      <Section>
        <div role="tablist" aria-label={t.events.title} className="mb-8 inline-flex rounded-xl bg-navy-50 p-1">
          {(['upcoming', 'past'] as const).map((w) => (
            <button
              key={w}
              role="tab"
              type="button"
              aria-selected={when === w}
              onClick={() => {
                setWhen(w);
                setPage(1);
              }}
              className={cx(
                'rounded-lg px-5 py-2 text-sm font-semibold transition',
                when === w ? 'bg-white text-royal-700 shadow-sm' : 'text-navy-700 hover:text-royal-700',
              )}
            >
              {w === 'upcoming' ? t.common.upcoming : t.common.past}
            </button>
          ))}
        </div>
        <QueryView state={state} retry={retry} empty={when === 'upcoming' ? t.events.emptyUpcoming : t.common.emptyEvents}>
          {(rows, count) => (
            <>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {rows.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
              <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)} onChange={setPage} />
            </>
          )}
        </QueryView>
      </Section>
    </>
  );
}

export function CalendarPage() {
  const { t, lang, pick, formatDate } = useLang();
  usePageMeta(t.calendar.title, t.calendar.subtitle);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [type, setType] = useState<EventType | ''>('');

  const { state, retry } = useQuery<SchoolEvent[]>(
    (db) => {
      let query = db
        .from('events')
        .select(EVENT_COLUMNS)
        .eq('status', 'published')
        .gte('starts_on', `${year}-01-01`)
        .lte('starts_on', `${year}-12-31`);
      if (type) query = query.eq('event_type', type);
      return query.order('starts_on').limit(500);
    },
    [year, type],
  );

  const years = [thisYear - 1, thisYear, thisYear + 1];
  const fmtYear = (y: number) => (lang === 'bn' ? toBnDigits(String(y)) : String(y));

  return (
    <>
      <PageHeader title={t.calendar.title} subtitle={t.calendar.subtitle} crumbs={[{ to: '/academics', label: t.nav.academics }]} />
      <Section>
        <div className="mb-8 flex flex-col gap-3 sm:flex-row">
          <label className="sm:w-40">
            <span className="sr-only">{t.common.year}</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {fmtYear(y)}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:w-56">
            <span className="sr-only">{t.common.allTypes}</span>
            <select value={type} onChange={(e) => setType(e.target.value as EventType | '')} className={inputClass}>
              <option value="">{t.common.allTypes}</option>
              {EVENT_TYPES.map((et) => (
                <option key={et} value={et}>
                  {t.eventTypes[et]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <QueryView state={state} retry={retry} empty={t.calendar.empty}>
          {(rows) => <CalendarList rows={rows} pick={pick} formatDate={formatDate} typeLabel={(e) => t.eventTypes[e]} />}
        </QueryView>
      </Section>
    </>
  );
}

function CalendarList({
  rows,
  pick,
  formatDate,
  typeLabel,
}: {
  rows: SchoolEvent[];
  pick: (a?: string | null, b?: string | null) => string;
  formatDate: (v: string | Date, o?: Intl.DateTimeFormatOptions) => string;
  typeLabel: (e: EventType) => string;
}) {
  const months = useMemo(() => {
    const map = new Map<string, SchoolEvent[]>();
    for (const r of rows) {
      const key = r.starts_on.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-8">
      {months.map(([month, items]) => (
        <section key={month}>
          <h2 className="heading mb-3 border-b-2 border-gold-400 pb-2 text-lg font-bold text-navy-900">
            {formatDate(month + '-01T00:00:00', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <tbody className="divide-y divide-navy-100">
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="w-48 whitespace-nowrap py-3 pr-4 font-semibold text-navy-800">
                      {formatDate(e.starts_on + 'T00:00:00', { day: 'numeric', month: 'short' })}
                      {e.ends_on && e.ends_on !== e.starts_on &&
                        ` – ${formatDate(e.ends_on + 'T00:00:00', { day: 'numeric', month: 'short' })}`}
                    </td>
                    <td className="py-3 pr-4 text-slate-800">{pick(e.title_en, e.title_bn)}</td>
                    <td className="py-3 text-right">
                      <span className="rounded-full bg-royal-50 px-2.5 py-0.5 text-xs font-semibold text-royal-700">
                        {typeLabel(e.event_type)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
