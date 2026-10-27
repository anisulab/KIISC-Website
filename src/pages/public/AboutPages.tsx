import { CheckCircle2, Compass, Target, UserRound } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { Card, PageHeader, Placeholder, Section, SectionHeading, Spinner } from '@/components/ui';

export function AboutPage() {
  const { t, pick } = useLang();
  const inst = useInstitution();
  usePageMeta(t.about.title, pick(inst.about_en, inst.about_bn));

  const details: { label: string; value: string | null }[] = [
    { label: t.about.eiin, value: inst.eiin },
    { label: t.about.established, value: inst.established_year ? String(inst.established_year) : null },
    { label: t.about.board, value: inst.board_affiliation },
    { label: t.about.streams, value: `${t.nav.banglaMedium}, ${t.nav.englishVersion}` },
  ];

  return (
    <>
      <PageHeader title={t.about.title} subtitle={t.about.subtitle} />
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="heading text-2xl font-semibold leading-relaxed text-navy-900">
              {pick(inst.about_en, inst.about_bn)}
            </p>
            <h2 className="heading mt-10 text-xl font-bold text-navy-900">{t.about.commitmentTitle}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {t.about.commitments.map((c) => (
                <li key={c} className="flex items-center gap-3 rounded-xl bg-navy-50/70 px-4 py-3 font-medium text-navy-800">
                  <CheckCircle2 className="h-5 w-5 text-gold-500" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>

            <h2 className="heading mt-12 text-xl font-bold text-navy-900">{t.about.principalTitle}</h2>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-navy-50 text-navy-300">
                <UserRound className="h-12 w-12" aria-hidden />
              </div>
              <div className="flex-1">
                <Placeholder label={t.about.principalTitle} />
              </div>
            </div>
          </div>

          <aside>
            <Card>
              <h2 className="heading text-lg font-bold text-navy-900">{t.about.detailsTitle}</h2>
              <dl className="mt-4 divide-y divide-navy-100">
                {details.map((d) => (
                  <div key={d.label} className="flex justify-between gap-4 py-3 text-sm">
                    <dt className="text-slate-500">{d.label}</dt>
                    <dd className="text-right font-semibold text-navy-900">
                      {d.value ?? <span className="font-medium text-gold-600">{t.common.toBeConfirmed}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </aside>
        </div>
      </Section>
    </>
  );
}

export function MissionVisionPage() {
  const { t, pick } = useLang();
  const inst = useInstitution();
  usePageMeta(t.missionVision.title, pick(inst.mission_en, inst.mission_bn));

  const blocks = [
    { icon: Compass, title: t.home.missionTitle, body: pick(inst.mission_en, inst.mission_bn) },
    { icon: Target, title: t.home.visionTitle, body: pick(inst.vision_en, inst.vision_bn) },
  ];

  return (
    <>
      <PageHeader title={t.missionVision.title} subtitle={t.missionVision.subtitle} crumbs={[{ to: '/about', label: t.nav.about }]} />
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {blocks.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="border-t-4 border-t-gold-500 p-8">
              <Icon className="h-9 w-9 text-royal-600" aria-hidden />
              <h2 className="heading mt-4 text-2xl font-bold text-navy-900">{title}</h2>
              <p className="mt-3 text-lg leading-relaxed text-slate-700">{body}</p>
            </Card>
          ))}
        </div>
      </Section>
      <Section tone="tint">
        <SectionHeading title={t.missionVision.valuesTitle} />
        <ul className="flex flex-wrap gap-3">
          {t.missionVision.values.map((v) => (
            <li key={v} className="rounded-full border border-navy-200 bg-white px-5 py-2 font-semibold text-navy-800">
              {v}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

export function FacultyPage() {
  const { t, pick } = useLang();
  usePageMeta(t.faculty.title, t.faculty.subtitle);
  // Only teachers marked for publication (with consent); no contact details.
  const faculty = useQuery<{ id: string; name_en: string; name_bn: string | null; designation_en: string | null; designation_bn: string | null }[]>(
    (db) => db.rpc('get_public_faculty'),
    [],
  );
  const rows = faculty.state.status === 'ready' ? faculty.state.data : [];
  return (
    <>
      <PageHeader title={t.faculty.title} subtitle={t.faculty.subtitle} crumbs={[{ to: '/about', label: t.nav.about }]} />
      <Section>
        {faculty.state.status === 'loading' ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Placeholder label={t.faculty.title} note={t.faculty.body} />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((f) => (
              <li key={f.id}>
                <Card className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-300">
                    <UserRound className="h-7 w-7" aria-hidden />
                  </div>
                  <div>
                    <p className="font-semibold text-navy-900">{pick(f.name_en, f.name_bn)}</p>
                    <p className="text-sm text-slate-500">{pick(f.designation_en, f.designation_bn)}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
