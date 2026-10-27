import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, Languages, LogIn, Mail, Menu, MessageCircle, Phone, X } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { toBnDigits, toInternational } from '@/lib/institution';
import { Container, Logo, buttonClass, cx } from '@/components/ui';
import { buildNav, type NavGroup } from './navigation';

function LanguageSwitch({ className }: { className?: string }) {
  const { t, toggleLang } = useLang();
  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label={t.switchAria}
      className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold', className)}
    >
      <Languages className="h-4 w-4" aria-hidden />
      <span lang={t.langCode === 'bn' ? 'en' : 'bn'}>{t.switchLabel}</span>
    </button>
  );
}

function TopBar() {
  const { t, lang } = useLang();
  const inst = useInstitution();
  const phone = lang === 'bn' ? toBnDigits(inst.phone) : inst.phone;
  return (
    <div className="bg-navy-950 text-xs text-navy-100 sm:text-sm">
      <Container className="flex items-center justify-between gap-3 py-2">
        <div className="flex min-w-0 items-center gap-4">
          <a href={`tel:+${toInternational(inst.phone)}`} className="inline-flex items-center gap-1.5 hover:text-white">
            <Phone className="h-3.5 w-3.5 text-gold-400" aria-hidden />
            <span>{phone}</span>
          </a>
          {inst.whatsapp && (
            <a
              href={`https://wa.me/${toInternational(inst.whatsapp)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 hover:text-white sm:inline-flex"
            >
              <MessageCircle className="h-3.5 w-3.5 text-gold-400" aria-hidden />
              {t.common.whatsapp}
            </a>
          )}
          <a href={`mailto:${inst.email}`} className="hidden items-center gap-1.5 hover:text-white md:inline-flex">
            <Mail className="h-3.5 w-3.5 text-gold-400" aria-hidden />
            {inst.email}
          </a>
        </div>
        <LanguageSwitch className="text-gold-300 hover:bg-white/10 hover:text-white" />
      </Container>
    </div>
  );
}

function DesktopDropdown({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const { pathname } = useLocation();
  const active = group.children?.some((c) => pathname === c.to || pathname.startsWith(c.to + '/'));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <li ref={ref} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-semibold transition xl:px-3',
          active ? 'text-royal-700' : 'text-navy-800 hover:text-royal-700',
        )}
      >
        {group.label}
        <ChevronDown className={cx('h-4 w-4 transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 pt-2">
          <ul className="min-w-56 rounded-xl border border-navy-100 bg-white p-2 shadow-xl">
            {group.children!.map((c) => (
              <li key={c.to}>
                <NavLink
                  to={c.to}
                  end
                  className={({ isActive }) =>
                    cx(
                      'block rounded-lg px-3 py-2 text-sm',
                      isActive ? 'bg-royal-50 font-semibold text-royal-700' : 'text-navy-800 hover:bg-navy-50',
                    )
                  }
                >
                  {c.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function MobileMenu({ nav, onClose }: { nav: NavGroup[]; onClose: () => void }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cx('block rounded-lg px-3 py-2.5', isActive ? 'bg-royal-50 font-semibold text-royal-700' : 'text-navy-800 hover:bg-navy-50');

  return (
    <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label={t.nav.mainNav}>
      <div className="absolute inset-0 bg-navy-950/60" onClick={onClose} aria-hidden />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
          <LanguageSwitch className="text-royal-700 hover:bg-royal-50" />
          <button type="button" onClick={onClose} className="rounded-md p-2 text-navy-800 hover:bg-navy-50" aria-label={t.nav.closeMenu}>
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>
        <nav className="flex-1 px-4 py-4" aria-label={t.nav.mainNav}>
          <ul className="space-y-1">
            {nav.map((g) =>
              g.children ? (
                <li key={g.label} className="pt-3">
                  <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wider text-gold-600">{g.label}</p>
                  <ul>
                    {g.children.map((c) => (
                      <li key={c.to}>
                        <NavLink to={c.to} end className={linkClass} onClick={onClose}>
                          {c.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={g.to}>
                  <NavLink to={g.to!} end className={linkClass} onClick={onClose}>
                    {g.label}
                  </NavLink>
                </li>
              ),
            )}
          </ul>
        </nav>
        <div className="border-t border-navy-100 p-4">
          <Link to="/login" onClick={onClose} className={buttonClass('primary', 'w-full')}>
            <LogIn className="h-4 w-4" aria-hidden />
            {t.nav.login}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function Header() {
  const { t, pick } = useLang();
  const inst = useInstitution();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const nav = buildNav(t);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <header className="no-print sticky top-0 z-30 shadow-sm">
      <TopBar />
      <div className="border-b border-navy-100 bg-white/95 backdrop-blur">
        <Container className="flex items-center justify-between gap-4 py-3">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <Logo className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
            <span className="min-w-0">
              <span className="heading line-clamp-2 max-w-[17rem] text-sm font-bold leading-tight text-navy-900 xl:max-w-xs xl:text-base">
                {pick(inst.name_en, inst.name_bn)}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {t.nav.banglaMedium} · {t.nav.englishVersion}
              </span>
            </span>
          </Link>

          <nav aria-label={t.nav.mainNav} className="hidden xl:block">
            <ul className="flex items-center">
              {nav.map((g) =>
                g.children ? (
                  <DesktopDropdown key={g.label} group={g} />
                ) : (
                  <li key={g.to}>
                    <NavLink
                      to={g.to!}
                      end
                      className={({ isActive }) =>
                        cx(
                          'whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-semibold transition xl:px-3',
                          isActive ? 'text-royal-700' : 'text-navy-800 hover:text-royal-700',
                        )
                      }
                    >
                      {g.label}
                    </NavLink>
                  </li>
                ),
              )}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/login" className={buttonClass('primary', 'hidden whitespace-nowrap px-4 xl:inline-flex')}>
              <LogIn className="h-4 w-4" aria-hidden />
              {t.nav.login}
            </Link>
            <button
              type="button"
              className="rounded-md p-2 text-navy-800 hover:bg-navy-50 xl:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t.nav.openMenu}
              aria-expanded={mobileOpen}
            >
              <Menu className="h-6 w-6" aria-hidden />
            </button>
          </div>
        </Container>
      </div>
      {mobileOpen && <MobileMenu nav={nav} onClose={() => setMobileOpen(false)} />}
    </header>
  );
}
