import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarClock, Info, Layers } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useClassOfferings } from '@/lib/academics';
import { ButtonLink, Card, PageHeader, Placeholder, Section, SectionHeading, Spinner } from '@/components/ui';
import { StreamClassChips, StreamIcon } from '@/components/content';

type Stream = 'bangla_medium' | 'english_version';

function MediumNotes() {
  const { t } = useLang();
  const notes = [
    { title: t.academics.noteTitle, body: t.academics.noteBody },
    { title: t.academics.versionVsMediumTitle, body: t.academics.versionVsMediumBody },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {notes.map((n) => (
        <div key={n.title} className="flex gap-3 rounded-xl border border-royal-100 bg-royal-50/60 p-5">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" aria-hidden />
          <div>
            <p className="font-semibold text-navy-900">{n.title}</p>
            <p className="mt-1 text-sm text-slate-700">{n.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AcademicsPage() {
  const { t } = useLang();
  usePageMeta(t.academics.title, t.academics.intro);
  const streams: { key: Stream; title: string; body: string; to: string }[] = [
    { key: 'bangla_medium', title: t.nav.banglaMedium, body: t.home.bmBody, to: '/academics/bangla-medium' },
    { key: 'english_version', title: t.nav.englishVersion, body: t.home.evBody, to: '/academics/english-version' },
  ];
  return (
    <>
      <PageHeader title={t.academics.title} subtitle={t.academics.subtitle} />
      <Section>
        <p className="max-w-3xl text-lg text-slate-700">{t.academics.intro}</p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {streams.map((s) => (
            <Card key={s.key} className="p-8">
              <StreamIcon stream={s.key} />
              <h2 className="heading mt-5 text-2xl font-bold text-navy-900">{s.title}</h2>
              <p className="mt-3 text-slate-600">{s.body}</p>
              <ButtonLink to={s.to} variant="outline" className="mt-6">
                {t.common.learnMore} <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            </Card>
          ))}
        </div>
        <div className="mt-8">
          <MediumNotes />
        </div>
      </Section>
      <Section tone="tint">
        <SectionHeading title={t.home.levelsTitle} />
        <Placeholder label={t.home.levelsTitle} note={t.home.levelsBody} />
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink to="/examinations" variant="outline">{t.nav.examinations}</ButtonLink>
          <ButtonLink to="/academic-calendar" variant="outline">{t.nav.calendar}</ButtonLink>
          <ButtonLink to="/resources" variant="outline">{t.nav.resources}</ButtonLink>
        </div>
      </Section>
    </>
  );
}

export function StreamPage({ stream }: { stream: Stream }) {
  const { t, pick } = useLang();
  const isBm = stream === 'bangla_medium';
  const title = isBm ? t.nav.banglaMedium : t.nav.englishVersion;
  const intro = isBm ? t.academics.bmIntro : t.academics.evIntro;
  const body = isBm ? t.home.bmBody : t.home.evBody;
  usePageMeta(title, `${intro} ${body}`);

  const offerings = useClassOfferings();
  const subjects = useQuery<{ subject: { id: string; name_en: string; name_bn: string | null; is_active: boolean } }[]>(
    (db) => db.from('class_subjects').select('subject:subjects(id,name_en,name_bn,is_active)').eq('medium', stream),
    [stream],
  );
  const classes = offerings.state.status === 'ready' ? offerings.state.data : [];
  const subjectList =
    subjects.state.status === 'ready'
      ? [...new Map(subjects.state.data.filter((r) => r.subject?.is_active).map((r) => [r.subject.id, r.subject])).values()]
      : [];
  const loading = offerings.state.status === 'loading' || subjects.state.status === 'loading';

  const blocks = [
    {
      icon: Layers,
      title: t.academics.classesTitle,
      content: classes.some((c) => c.class_streams.some((s) => s.medium === stream)) ? (
        <StreamClassChips classes={classes} medium={stream} />
      ) : null,
    },
    {
      icon: BookOpen,
      title: t.academics.subjectsTitle,
      content: subjectList.length ? (
        <>
          <ul className="flex flex-wrap gap-2">
            {subjectList.map((s) => (
              <li key={s.id} className="rounded-full bg-royal-50 px-3 py-1 text-sm font-medium text-royal-700">
                {pick(s.name_en, s.name_bn)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">{t.academics.subjectsNote}</p>
        </>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={title} subtitle={intro} crumbs={[{ to: '/academics', label: t.nav.academics }]} />
      <Section>
        <div className="flex items-start gap-5">
          <StreamIcon stream={stream} />
          <p className="max-w-3xl text-lg text-slate-700">{body}</p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {blocks.map(({ icon: Icon, title: blockTitle, content }) => (
            <Card key={blockTitle}>
              <h2 className="heading flex items-center gap-2 text-lg font-bold text-navy-900">
                <Icon className="h-5 w-5 text-royal-600" aria-hidden />
                {blockTitle}
              </h2>
              <div className="mt-4">
                {content ?? (loading ? <Spinner /> : <Placeholder label={`${title}: ${blockTitle}`} />)}
              </div>
            </Card>
          ))}
        </div>
        <Card className="mt-6">
          <h2 className="heading flex items-center gap-2 text-lg font-bold text-navy-900">
            <CalendarClock className="h-5 w-5 text-royal-600" aria-hidden />
            {t.academics.resourcesTitle}
          </h2>
          <p className="mt-2 text-slate-600">{t.academics.resourcesBody}</p>
        </Card>
        <div className="mt-8">
          <MediumNotes />
        </div>
        <p className="mt-8 text-sm">
          <Link
            to={isBm ? '/academics/english-version' : '/academics/bangla-medium'}
            className="inline-flex items-center gap-1.5 font-semibold text-royal-700 hover:underline"
          >
            {isBm ? t.nav.englishVersion : t.nav.banglaMedium} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </p>
      </Section>
    </>
  );
}
