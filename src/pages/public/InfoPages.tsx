import { Link } from 'react-router-dom';
import { ChevronDown, Clock, Compass, MessageCircle } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { usePageMeta } from '@/hooks/usePageMeta';
import { toInternational } from '@/lib/institution';
import { Card, Container, DraftBadge, PageHeader, Placeholder, Section, buttonClass } from '@/components/ui';
import { ContactCards } from '@/components/content';

export function ContactPage() {
  const { t, pick } = useLang();
  const inst = useInstitution();
  usePageMeta(t.contact.title, `${inst.address_en} · ${inst.phone} · ${inst.email}`);
  const mapQuery = encodeURIComponent(inst.address_en);
  const hours = pick(inst.office_hours_en, inst.office_hours_bn);

  return (
    <>
      <PageHeader title={t.contact.title} subtitle={t.contact.subtitle} />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-6">
            <ContactCards />
            <Card>
              <h2 className="heading flex items-center gap-2 text-lg font-bold text-navy-900">
                <Clock className="h-5 w-5 text-royal-600" aria-hidden />
                {t.contact.hoursTitle}
              </h2>
              <div className="mt-3">
                {hours ? <p className="whitespace-pre-line text-slate-700">{hours}</p> : <Placeholder label={t.contact.hoursTitle} />}
              </div>
            </Card>
            <div className="flex flex-wrap gap-3">
              {inst.whatsapp && (
                <a
                  href={`https://wa.me/${toInternational(inst.whatsapp)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass('primary')}
                >
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  {t.contact.whatsappCta}
                </a>
              )}
              <a href={`mailto:${inst.email}`} className={buttonClass('outline')}>
                {t.contact.emailCta}
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-navy-100 bg-navy-50 shadow-sm">
            <iframe
              title={t.contact.mapTitle}
              src={`https://www.google.com/maps?q=${mapQuery}&output=embed`}
              className="h-[420px] w-full lg:h-full lg:min-h-[480px]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </Section>
    </>
  );
}

export function FaqPage() {
  const { t } = useLang();
  usePageMeta(t.faq.title, t.faq.subtitle);
  return (
    <>
      <PageHeader title={t.faq.title} subtitle={t.faq.subtitle} crumbs={[{ to: '/about', label: t.nav.about }]} />
      <Section>
        <div className="mx-auto max-w-3xl space-y-3">
          {t.faq.items.map((item, i) => (
            <details
              key={item.q}
              className="group rounded-xl border border-navy-100 bg-white p-5 shadow-sm open:border-royal-200"
              open={i === 0}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-navy-900">
                {item.q}
                <ChevronDown className="h-5 w-5 shrink-0 text-royal-600 transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-3 text-slate-700">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}

function LegalPage({ title, subtitle, sections }: { title: string; subtitle: string; sections: { h: string; p: string }[] }) {
  usePageMeta(title, subtitle);
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Section>
        <article className="mx-auto max-w-3xl">
          <DraftBadge />
          {sections.map((s) => (
            <section key={s.h} className="mb-8">
              <h2 className="heading text-xl font-bold text-navy-900">{s.h}</h2>
              <p className="mt-2 leading-relaxed text-slate-700">{s.p}</p>
            </section>
          ))}
        </article>
      </Section>
    </>
  );
}

export function PrivacyPage() {
  const { t } = useLang();
  return <LegalPage {...t.privacy} />;
}

export function TermsPage() {
  const { t } = useLang();
  return <LegalPage {...t.terms} />;
}

export function NotFoundPage() {
  const { t } = useLang();
  usePageMeta(t.notFound.title, t.notFound.body, { noindex: true });
  return (
    <Container className="flex flex-col items-center py-24 text-center">
      <Compass className="h-14 w-14 text-gold-500" aria-hidden />
      <p className="heading mt-6 text-6xl font-bold text-navy-900">404</p>
      <h1 className="heading mt-2 text-2xl font-bold text-navy-900">{t.notFound.title}</h1>
      <p className="mt-3 max-w-md text-slate-600">{t.notFound.body}</p>
      <Link to="/" className={buttonClass('primary', 'mt-8')}>
        {t.notFound.home}
      </Link>
    </Container>
  );
}
