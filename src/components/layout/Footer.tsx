import { Link } from 'react-router-dom';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { toBnDigits, toInternational } from '@/lib/institution';
import { Container, Logo } from '@/components/ui';

export default function Footer() {
  const { t, lang, pick } = useLang();
  const inst = useInstitution();
  const n = t.nav;
  const phone = lang === 'bn' ? toBnDigits(inst.phone) : inst.phone;
  const year = new Date().getFullYear();

  const quick = [
    { to: '/about', label: n.aboutUs },
    { to: '/admissions', label: n.admissions },
    { to: '/notices', label: n.notices },
    { to: '/events', label: n.events },
    { to: '/gallery', label: n.gallery },
    { to: '/faq', label: n.faq },
  ];
  const academics = [
    { to: '/academics/bangla-medium', label: n.banglaMedium },
    { to: '/academics/english-version', label: n.englishVersion },
    { to: '/examinations', label: n.examinations },
    { to: '/academic-calendar', label: n.calendar },
    { to: '/resources', label: n.resources },
  ];

  return (
    <footer className="no-print bg-navy-950 text-navy-100">
      <div className="h-1 bg-gradient-to-r from-gold-600 via-gold-400 to-gold-600" aria-hidden />
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-3">
            <Logo className="h-12 w-12 shrink-0" />
            <p className="heading text-base font-bold leading-snug text-white">{pick(inst.name_en, inst.name_bn)}</p>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-navy-200">{pick(inst.about_en, inst.about_bn)}</p>
        </div>

        <FooterList title={t.footer.quickLinks} links={quick} />
        <FooterList title={t.footer.academics} links={academics} />

        <div>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-gold-400">{t.footer.contact}</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" aria-hidden />
              <span>{pick(inst.address_en, inst.address_bn)}</span>
            </li>
            <li>
              <a href={`tel:+${toInternational(inst.phone)}`} className="flex gap-3 hover:text-white">
                <Phone className="h-4 w-4 shrink-0 text-gold-400" aria-hidden />
                {phone}
              </a>
            </li>
            {inst.whatsapp && (
              <li>
                <a
                  href={`https://wa.me/${toInternational(inst.whatsapp)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 hover:text-white"
                >
                  <MessageCircle className="h-4 w-4 shrink-0 text-gold-400" aria-hidden />
                  {t.common.whatsapp}
                </a>
              </li>
            )}
            <li>
              <a href={`mailto:${inst.email}`} className="flex gap-3 break-all hover:text-white">
                <Mail className="h-4 w-4 shrink-0 text-gold-400" aria-hidden />
                {inst.email}
              </a>
            </li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-white/10">
        <Container className="flex flex-col gap-3 py-5 text-xs text-navy-300 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {lang === 'bn' ? toBnDigits(String(year)) : year} {pick(inst.name_en, inst.name_bn)}. {t.footer.rights}
          </p>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-white">
              {n.privacy}
            </Link>
            <Link to="/terms" className="hover:text-white">
              {n.terms}
            </Link>
            <Link to="/contact" className="hover:text-white">
              {n.contact}
            </Link>
          </div>
        </Container>
      </div>
    </footer>
  );
}

function FooterList({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-gold-400">{title}</h2>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="hover:text-white">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
