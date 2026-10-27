import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarRange,
  Link2,
  Coins,
  FilePlus2,
  PieChart,
  Wallet,
  Award,
  NotebookPen,
  BarChart3,
  CalendarCheck,
  CalendarCog,
  FilePen,
  Presentation,
  ArrowUpCircle,
  UserCog,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  SlidersHorizontal,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  History,
  Mail,
  Image,
  Languages,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useAuth, type AppRole } from '@/auth/AuthProvider';
import {
  ACADEMIC_ADMIN_ROLES,
  ADMISSION_VIEW_ROLES,
  ATTENDANCE_VIEW_ROLES,
  EXAM_VIEW_ROLES,
  FINANCE_MANAGE_ROLES,
  FINANCE_VIEW_ROLES,
  TEACHING_ADMIN_ROLES,
  AUDIT_ROLES,
  CONTENT_ROLES,
  NOTIFICATION_ROLES,
  REPORT_ROLES,
  SETTINGS_VIEW_ROLES,
  STAFF_ROLES,
  STUDENT_MANAGE_ROLES,
  STUDENT_VIEW_ROLES,
  USER_ADMIN_ROLES,
  hasAnyRole,
} from '@/auth/roles';
import { AccessDenied, RequireAuth } from '@/auth/guards';
import { supabase } from '@/integrations/supabase/client';
import { Logo, Spinner, cx } from '@/components/ui';
import { ToastProvider } from './adminUi';
import { MfaGate } from '@/auth/Mfa';
import { useIdleSignOut } from '@/auth/useIdleSignOut';

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: AppRole[];
  end?: boolean;
}

function useMenu() {
  const { t } = useLang();
  const m = t.admin.menu;
  const groups: { label?: string; items: Item[] }[] = [
    { items: [{ to: '/admin', label: m.dashboard, icon: LayoutDashboard, roles: STAFF_ROLES, end: true }] },
    {
      label: m.content,
      items: [
        { to: '/admin/content/notices', label: m.notices, icon: Megaphone, roles: CONTENT_ROLES },
        { to: '/admin/content/events', label: m.events, icon: CalendarDays, roles: CONTENT_ROLES },
        { to: '/admin/content/gallery', label: m.gallery, icon: Image, roles: CONTENT_ROLES },
        { to: '/admin/content/documents', label: m.documents, icon: FileText, roles: CONTENT_ROLES },
      ],
    },
    {
      label: m.studentsGroup,
      items: [
        { to: '/admin/students', label: m.students, icon: Users, roles: STUDENT_VIEW_ROLES },
        { to: '/admin/promotion', label: m.promotion, icon: ArrowUpCircle, roles: STUDENT_MANAGE_ROLES },
        { to: '/admin/link-requests', label: m.linkRequests, icon: Link2, roles: STUDENT_MANAGE_ROLES },
      ],
    },
    {
      label: m.financeGroup,
      items: [
        { to: '/admin/finance/invoices', label: m.invoices, icon: FileText, roles: FINANCE_VIEW_ROLES },
        { to: '/admin/finance/payments', label: m.payments, icon: Wallet, roles: FINANCE_VIEW_ROLES },
        { to: '/admin/finance/generate', label: m.billing, icon: FilePlus2, roles: FINANCE_MANAGE_ROLES },
        { to: '/admin/finance/setup', label: m.feeSetup, icon: Coins, roles: FINANCE_VIEW_ROLES },
        { to: '/admin/finance/reports', label: m.financeReports, icon: PieChart, roles: FINANCE_VIEW_ROLES },
      ],
    },
    {
      label: m.examsGroup,
      items: [
        { to: '/admin/exams', label: m.exams, icon: NotebookPen, roles: EXAM_VIEW_ROLES },
        { to: '/admin/grading', label: m.grading, icon: Award, roles: EXAM_VIEW_ROLES },
      ],
    },
    {
      label: m.attendanceGroup,
      items: [
        { to: '/admin/attendance', label: m.attendance, icon: CalendarCheck, roles: ATTENDANCE_VIEW_ROLES },
        { to: '/admin/attendance-corrections', label: m.corrections, icon: FilePen, roles: ATTENDANCE_VIEW_ROLES },
        { to: '/admin/attendance-reports', label: m.attendanceReports, icon: BarChart3, roles: ATTENDANCE_VIEW_ROLES },
        { to: '/admin/attendance-settings', label: m.attendanceSettings, icon: CalendarCog, roles: TEACHING_ADMIN_ROLES },
      ],
    },
    {
      label: m.admissions,
      items: [
        { to: '/admin/admissions', label: m.applications, icon: ClipboardList, roles: ADMISSION_VIEW_ROLES },
        { to: '/admin/admissions-settings', label: m.admissionSettings, icon: SlidersHorizontal, roles: ACADEMIC_ADMIN_ROLES },
      ],
    },
    {
      label: m.academics,
      items: [
        { to: '/admin/academics', label: m.academicSetup, icon: GraduationCap, roles: ACADEMIC_ADMIN_ROLES },
        { to: '/admin/teachers', label: m.teachers, icon: Presentation, roles: TEACHING_ADMIN_ROLES },
        { to: '/admin/timetable', label: m.timetable, icon: CalendarRange, roles: TEACHING_ADMIN_ROLES },
        { to: '/admin/resources', label: m.resources, icon: BookOpen, roles: EXAM_VIEW_ROLES },
      ],
    },
    {
      label: m.administration,
      items: [
        { to: '/admin/reports', label: m.reports, icon: FileSpreadsheet, roles: REPORT_ROLES },
        { to: '/admin/notifications', label: m.notifications, icon: Mail, roles: NOTIFICATION_ROLES },
        { to: '/admin/users', label: m.users, icon: UserCog, roles: USER_ADMIN_ROLES },
        { to: '/admin/settings', label: m.settings, icon: Settings, roles: SETTINGS_VIEW_ROLES },
        { to: '/admin/security', label: m.security, icon: ShieldCheck, roles: AUDIT_ROLES },
        { to: '/admin/audit', label: m.audit, icon: History, roles: AUDIT_ROLES },
      ],
    },
  ];
  return groups;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t, toggleLang } = useLang();
  const { me } = useAuth();
  const navigate = useNavigate();
  const groups = useMenu()
    .map((g) => ({ ...g, items: g.items.filter((i) => hasAnyRole(me, i.roles)) }))
    .filter((g) => g.items.length);

  const signOut = async () => {
    await supabase?.auth.signOut();
    navigate('/', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
      isActive ? 'bg-white/10 text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white',
    );

  return (
    <div className="flex h-full flex-col bg-navy-950 text-navy-100">
      <Link to="/admin" onClick={onNavigate} className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <Logo className="h-10 w-10 shrink-0" />
        <span>
          <span className="block text-sm font-bold text-white">{t.meta.shortName}</span>
          <span className="block text-xs text-gold-300">{t.admin.console}</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label={t.admin.console}>
        {groups.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label && <p className="mb-2 px-3 text-xs font-bold uppercase tracking-wider text-gold-400/90">{g.label}</p>}
            <ul className="space-y-1">
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink to={to} end={end} className={linkClass} onClick={onNavigate}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-white/10 px-3 py-4">
        <NavLink to="/admin/account" className={linkClass} onClick={onNavigate}>
          <UserCircle className="h-4 w-4" aria-hidden />
          <span className="min-w-0 truncate">{me?.full_name || me?.email || t.admin.menu.account}</span>
        </NavLink>
        <button type="button" onClick={toggleLang} className={linkClass({ isActive: false }) + ' w-full'}>
          <Languages className="h-4 w-4" aria-hidden />
          {t.switchLabel}
        </button>
        <Link to="/" className={linkClass({ isActive: false })}>
          <ExternalLink className="h-4 w-4" aria-hidden />
          {t.admin.menu.viewSite}
        </Link>
        <button type="button" onClick={signOut} className={linkClass({ isActive: false }) + ' w-full'}>
          <LogOut className="h-4 w-4" aria-hidden />
          {t.admin.menu.signOut}
        </button>
      </div>
    </div>
  );
}

function AdminShell() {
  const { t } = useLang();
  const { me, initializing } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useIdleSignOut(hasAnyRole(me, STAFF_ROLES));
  useEffect(() => {
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (meta) meta.content = 'noindex, nofollow';
  }, [pathname]);

  if (initializing) return <Spinner />;
  if (!hasAnyRole(me, STAFF_ROLES)) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AccessDenied />
        <p className="text-center">
          <Link to="/portal" className="font-semibold text-royal-700 hover:underline">
            {t.portal.title}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="no-print hidden w-64 shrink-0 lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar />
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t.admin.console}>
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-2xl">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"
            aria-label={t.nav.closeMenu}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-navy-800 hover:bg-navy-50" aria-label={t.nav.openMenu}>
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <span className="text-sm font-bold text-navy-900">{t.admin.console}</span>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  return (
    <RequireAuth>
      <ToastProvider>
        <MfaGate>
          <AdminShell />
        </MfaGate>
      </ToastProvider>
    </RequireAuth>
  );
}
