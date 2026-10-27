import { ArrowRight, CheckCircle2, ClipboardList, FileCheck2, Lock, Phone, Search, Wallet } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { usePageMeta } from '@/hooks/usePageMeta';
import { toBnDigits, toInternational } from '@/lib/institution';
import { useAdmissionSettings, useDocumentTypes } from '@/lib/academics';
import { ButtonLink, Card, PageHeader, Placeholder, Section, SectionHeading, Spinner, buttonClass, cx } from '@/components/ui';

export function AdmissionsPage() {
  const { t, lang, pick } = useLang();
  const inst = useInstitution();
  usePageMeta(t.admissions.title, t.admissions.intro);
  const num = (i: number) => (lang === 'bn' ? toBnDigits(String(i)) : String(i));
  const settings = useAdmissionSettings();
  const s = settings.state.status === 'ready' ? settings.state.data : null;
  const isOpen = Boolean(s?.is_open);

  return (
    <>
      <PageHeader title={t.admissions.title} subtitle={t.admissions.subtitle} />
      <Section>
        <p className="max-w-3xl text-lg text-slate-700">{t.admissions.intro}</p>

        <div
          className={cx(
            'mt-8 flex flex-col gap-5 rounded-2xl border p-6 sm:flex-row sm:items-center sm:justify-between',
            isOpen ? 'border-emerald-200 bg-emerald-50/70' : 'border-navy-100 bg-navy-50/60',
          )}
        >
          <div className="flex gap-4">
            {isOpen ? (
              <ClipboardList className="h-8 w-8 shrink-0 text-emerald-700" aria-hidden />
            ) : (
              <Lock className="h-8 w-8 shrink-0 text-navy-700" aria-hidden />
            )}
            <div>
              <h2 className="heading text-lg font-bold text-navy-900">
                {settings.state.status === 'loading' ? t.common.loading : isOpen ? t.admissions.openTitle : t.admissions.closedTitle}
              </h2>
              <p className="mt-1 text-sm text-slate-700">{isOpen ? t.admissions.openBody : t.admissions.closedBody}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            {isOpen && (
              <ButtonLink to="/admissions/apply" variant="gold">
                {t.admissions.applyOnline} <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            )}
            <ButtonLink to="/admissions/status" variant="outline">
              <Search className="h-4 w-4" aria-hidden />
              {t.admissions.checkStatus}
            </ButtonLink>
          </div>
        </div>

        {s && pick(s.instructions_en, s.instructions_bn) && (
          <div className="mt-6 rounded-xl border border-royal-100 bg-white p-5 text-sm text-slate-700">
            <p className="mb-1 font-semibold text-navy-900">{t.admissions.instructionsTitle}</p>
            <p className="whitespace-pre-line">{pick(s.instructions_en, s.instructions_bn)}</p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink to="/notices?category=admission" variant="outline">
            {t.home.admissionCta}
          </ButtonLink>
          <ButtonLink to="/admissions/requirements" variant="outline">
            {t.admissions.requirementsCta} <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        </div>

        <h2 className="heading mt-14 text-2xl font-bold text-navy-900">{t.admissions.stepsTitle}</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-5">
          {t.admissions.steps.map((step, i) => (
            <li key={step.title} className="relative rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 font-bold text-gold-300">
                {num(i + 1)}
              </span>
              <p className="mt-3 font-semibold text-navy-900">{step.title}</p>
              <p className="mt-1 text-sm text-slate-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section tone="tint">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <Wallet className="h-7 w-7 text-royal-600" aria-hidden />
            <h2 className="heading mt-3 text-lg font-bold text-navy-900">{t.admissions.feesTitle}</h2>
            <p className="mt-2 text-sm text-slate-600">{t.admissions.feesBody}</p>
          </Card>
          <Card>
            <Phone className="h-7 w-7 text-royal-600" aria-hidden />
            <h2 className="heading mt-3 text-lg font-bold text-navy-900">{t.admissions.contactOffice}</h2>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <a href={`tel:+${toInternational(inst.phone)}`} className={buttonClass('primary')}>
                {t.contact.callCta}
              </a>
              {inst.whatsapp && (
                <a
                  href={`https://wa.me/${toInternational(inst.whatsapp)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass('outline')}
                >
                  {t.contact.whatsappCta}
                </a>
              )}
            </div>
          </Card>
        </div>
      </Section>
    </>
  );
}

export function RequirementsPage() {
  const { t, pick } = useLang();
  usePageMeta(t.requirements.title, t.requirements.subtitle);
  const settings = useAdmissionSettings();
  const docTypes = useDocumentTypes();
  const s = settings.state.status === 'ready' ? settings.state.data : null;
  const eligibility = s ? pick(s.eligibility_en, s.eligibility_bn) : '';

  return (
    <>
      <PageHeader
        title={t.requirements.title}
        subtitle={t.requirements.subtitle}
        crumbs={[{ to: '/admissions', label: t.nav.admissions }]}
      />
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading title={t.requirements.infoTitle} />
            <ul className="space-y-3">
              {t.requirements.info.map((item) => (
                <li key={item} className="flex gap-3 text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-8">
            <div>
              <h2 className="heading mb-3 flex items-center gap-2 text-lg font-bold text-navy-900">
                <FileCheck2 className="h-5 w-5 text-royal-600" aria-hidden />
                {t.requirements.documentsTitle}
              </h2>
              {docTypes.state.status === 'loading' ? (
                <Spinner />
              ) : docTypes.state.status === 'ready' && docTypes.state.data.length > 0 ? (
                <ul className="divide-y divide-navy-100 rounded-xl border border-navy-100 bg-white">
                  {docTypes.state.data.map((d) => (
                    <li key={d.id} className="flex items-start justify-between gap-4 p-4">
                      <div>
                        <p className="font-medium text-navy-900">{pick(d.name_en, d.name_bn)}</p>
                        {pick(d.description_en, d.description_bn) && (
                          <p className="text-sm text-slate-500">{pick(d.description_en, d.description_bn)}</p>
                        )}
                      </div>
                      <span
                        className={cx(
                          'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                          d.is_required ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {d.is_required ? t.apply.required : t.apply.optional}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Placeholder label={t.requirements.documentsTitle} />
              )}
            </div>
            <div>
              <h2 className="heading mb-3 text-lg font-bold text-navy-900">{t.requirements.eligibilityTitle}</h2>
              {eligibility ? (
                <p className="whitespace-pre-line rounded-xl border border-navy-100 bg-white p-4 text-slate-700">{eligibility}</p>
              ) : settings.state.status === 'loading' ? (
                <Spinner />
              ) : (
                <Placeholder label={t.requirements.eligibilityTitle} />
              )}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
