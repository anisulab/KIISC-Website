import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenCheck,
  Compass,
  HeartHandshake,
  Lightbulb,
  Megaphone,
  MapPin,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { type GalleryItem, type Notice, type SchoolEvent, nowIso, publicAssetUrl, todayIso } from '@/lib/content';
import { supabase } from '@/integrations/supabase/client';
import { ButtonLink, Card, Container, Placeholder, QueryView, Section, SectionHeading, buttonClass } from '@/components/ui';
import { ContactCards, EventCard, NoticeRow, StreamClassChips, StreamIcon } from '@/components/content';
import { useClassOfferings } from '@/lib/academics';

const WHY_ICONS = [Users, BookOpenCheck, ShieldCheck, Lightbulb, HeartHandshake, MapPin];

export default function HomePage() {
  const { t } = useLang();
  usePageMeta('', t.meta.description);

  return (
    <>
      <Hero />
      <AdmissionBanner />
      <Streams />
      <AboutMissionVision />
      <WhyChoose />
      <NoticesAndEvents />
      <GalleryPreview />
      <Section tone="tint">
        <SectionHeading
          title={t.home.contactTitle}
          intro={t.home.contactIntro}
          action={
            <ButtonLink to="/contact" variant="outline">
              {t.nav.contact} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          }
        />
        <ContactCards />
      </Section>
    </>
  );
}

function Hero() {
  const { t } = useLang();
  return (
    <section className="hero-pattern relative overflow-hidden text-white">
      <Container className="relative grid items-center gap-10 py-16 sm:py-24 lg:grid-cols-[1.4fr_1fr] lg:py-28">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold-400/40 bg-white/5 px-4 py-1.5 text-sm font-semibold text-gold-300">
            <Sparkles className="h-4 w-4" aria-hidden />
            {t.home.heroEyebrow}
          </p>
          <h1 className="heading text-4xl font-bold leading-tight sm:text-5xl lg:text-[3.4rem]">{t.home.heroTitle}</h1>
          <p className="mt-6 max-w-xl text-lg text-navy-100">{t.home.heroSubtitle}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/admissions" variant="gold" className="px-6 py-3 text-base">
              {t.home.apply}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink to="/academics" variant="outlineLight" className="px-6 py-3 text-base">
              {t.home.explore}
            </ButtonLink>
          </div>
        </div>
        <div className="hidden lg:block" aria-hidden>
          <div className="relative mx-auto aspect-square max-w-sm">
            <div className="absolute inset-0 rounded-[2.5rem] border border-white/15 bg-white/5 backdrop-blur" />
            <div className="absolute inset-6 rounded-[2rem] border border-gold-400/40" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-10 text-center">
              <span className="heading text-7xl font-bold text-white/90" lang="bn">অ</span>
              <span className="h-px w-24 bg-gold-400/70" />
              <span className="heading text-6xl font-bold text-gold-300" lang="en">Aa</span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function AdmissionBanner() {
  const { t } = useLang();
  return (
    <Container className="relative z-10 -mt-8">
      <div className="flex flex-col gap-4 rounded-2xl border border-gold-300 bg-white p-6 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold-100 text-gold-600">
            <Megaphone className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h2 className="heading text-lg font-bold text-navy-900">{t.home.admissionTitle}</h2>
            <p className="mt-1 text-sm text-slate-600">{t.home.admissionBody}</p>
          </div>
        </div>
        <Link to="/notices?category=admission" className={buttonClass('primary', 'shrink-0')}>
          {t.home.admissionCta}
        </Link>
      </div>
    </Container>
  );
}

function Streams() {
  const { t } = useLang();
  const offerings = useClassOfferings();
  const classes = offerings.state.status === 'ready' ? offerings.state.data : [];
  const streams = [
    { key: 'bangla_medium' as const, title: t.nav.banglaMedium, body: t.home.bmBody, to: '/academics/bangla-medium' },
    { key: 'english_version' as const, title: t.nav.englishVersion, body: t.home.evBody, to: '/academics/english-version' },
  ];
  return (
    <Section>
      <SectionHeading title={t.home.streamsTitle} intro={t.home.streamsIntro} />
      <div className="grid gap-6 md:grid-cols-2">
        {streams.map((s) => (
          <Card key={s.key} className="group relative overflow-hidden p-8 transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-[3rem] bg-gold-100/60" aria-hidden />
            <StreamIcon stream={s.key} />
            <h3 className="heading mt-5 text-2xl font-bold text-navy-900">{s.title}</h3>
            <p className="mt-3 text-slate-600">{s.body}</p>
            {classes.length > 0 && (
              <div className="mt-5">
                <StreamClassChips classes={classes} medium={s.key} />
              </div>
            )}
            <Link to={s.to} className="mt-6 inline-flex items-center gap-1.5 font-semibold text-royal-700 hover:gap-2.5">
              {t.common.learnMore} <ArrowRight className="h-4 w-4 transition-all" aria-hidden />
            </Link>
          </Card>
        ))}
      </div>
      {offerings.state.status !== 'loading' && classes.length === 0 && (
        <div className="mt-6">
          <Placeholder label={t.home.levelsTitle} note={t.home.levelsBody} />
        </div>
      )}
    </Section>
  );
}

function AboutMissionVision() {
  const { t, pick } = useLang();
  const inst = useInstitution();
  const cards = [
    { icon: Compass, title: t.home.missionTitle, body: pick(inst.mission_en, inst.mission_bn) },
    { icon: Target, title: t.home.visionTitle, body: pick(inst.vision_en, inst.vision_bn) },
  ];
  return (
    <Section tone="navy" className="hero-pattern">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <div>
          <SectionHeading title={t.home.aboutTitle} light />
          <p className="-mt-4 text-xl leading-relaxed text-navy-100">{pick(inst.about_en, inst.about_bn)}</p>
          <ButtonLink to="/about" variant="outlineLight" className="mt-8">
            {t.common.learnMore} <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {cards.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-white/15 bg-white/5 p-6 backdrop-blur">
              <Icon className="h-8 w-8 text-gold-400" aria-hidden />
              <h3 className="heading mt-4 text-lg font-bold text-white">{title}</h3>
              <p className="mt-2 text-navy-100">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function WhyChoose() {
  const { t } = useLang();
  return (
    <Section>
      <SectionHeading title={t.home.whyTitle} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {t.home.why.map((item, i) => {
          const Icon = WHY_ICONS[i];
          return (
            <Card key={item.title} className="p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-royal-50 text-royal-700">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-4 font-semibold text-navy-900">{item.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{item.body}</p>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

function NoticesAndEvents() {
  const { t } = useLang();
  const notices = useQuery<Notice[]>(
    (db) =>
      db
        .from('notices')
        .select('id,title_en,title_bn,body_en,body_bn,category,publish_at,expires_at,attachment_path')
        .eq('status', 'published')
        .lte('publish_at', nowIso())
        .or(`expires_at.is.null,expires_at.gt.${nowIso()}`)
        .order('publish_at', { ascending: false })
        .limit(5),
    [],
  );
  const events = useQuery<SchoolEvent[]>(
    (db) =>
      db
        .from('events')
        .select('id,title_en,title_bn,description_en,description_bn,event_type,starts_on,ends_on,location')
        .eq('status', 'published')
        .gte('starts_on', todayIso())
        .order('starts_on')
        .limit(3),
    [],
  );

  return (
    <Section tone="tint">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading
            title={t.home.latestNotices}
            action={
              <Link to="/notices" className="text-sm font-semibold text-royal-700 hover:underline">
                {t.common.viewAll}
              </Link>
            }
          />
          <QueryView state={notices.state} retry={notices.retry} empty={t.common.emptyNotices}>
            {(rows) => (
              <ul className="space-y-3">
                {rows.map((n) => (
                  <NoticeRow key={n.id} notice={n} />
                ))}
              </ul>
            )}
          </QueryView>
        </div>
        <div>
          <SectionHeading
            title={t.home.upcomingEvents}
            action={
              <Link to="/events" className="text-sm font-semibold text-royal-700 hover:underline">
                {t.common.viewAll}
              </Link>
            }
          />
          <QueryView state={events.state} retry={events.retry} empty={t.events.emptyUpcoming}>
            {(rows) => (
              <div className="space-y-4">
                {rows.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
            )}
          </QueryView>
        </div>
      </div>
    </Section>
  );
}

function GalleryPreview() {
  const { t, pick } = useLang();
  const gallery = useQuery<GalleryItem[]>(
    (db) =>
      db
        .from('gallery_items')
        .select('id,title_en,title_bn,image_path,album')
        .eq('status', 'published')
        .order('sort_order')
        .order('created_at', { ascending: false })
        .limit(6),
    [],
  );
  return (
    <Section>
      <SectionHeading
        title={t.home.galleryTitle}
        action={
          <Link to="/gallery" className="text-sm font-semibold text-royal-700 hover:underline">
            {t.common.viewAll}
          </Link>
        }
      />
      <QueryView state={gallery.state} retry={gallery.retry} empty={t.common.emptyGallery}>
        {(rows) => (
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            {rows.map((g) => (
              <li key={g.id} className="aspect-[4/3] overflow-hidden rounded-xl bg-navy-50">
                <img
                  src={publicAssetUrl(supabase!, g.image_path)}
                  alt={pick(g.title_en, g.title_bn)}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 hover:scale-105"
                />
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Section>
  );
}
