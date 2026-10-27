import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileText,
  GraduationCap,
  Image,
  Megaphone,
  NotebookPen,
  Plus,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { schoolToday } from '@/lib/attendance';
import { ADMISSION_VIEW_ROLES, ATTENDANCE_VIEW_ROLES, FINANCE_VIEW_ROLES, AUDIT_ROLES, CONTENT_ROLES, STUDENT_VIEW_ROLES, USER_ADMIN_ROLES, hasAnyRole } from '@/auth/roles';
import { isBackendConfigured, supabase } from '@/integrations/supabase/client';
import { nowIso, todayIso } from '@/lib/content';
import { toBnDigits } from '@/lib/institution';
import { EmptyState, QueryView, buttonClass } from '@/components/ui';
import { AdminPageHeader, Panel, StatusBadge } from '@/components/admin/adminUi';
import { AuditTable, type AuditRow } from './AuditPage';

type StatKey = 'activeStudents' | 'sectionsRecorded' | 'examsInReview' | 'collectedToday' | 'users' | 'newApplications' | 'inReview' | 'publishedNotices' | 'draftNotices' | 'upcomingEvents' | 'galleryItems' | 'documents';

/** Real counts from the database (RLS applies). Null while loading or if a count fails. */
function useStats(enabled: { content: boolean; users: boolean; admissions: boolean; students: boolean; attendance: boolean; finance: boolean }) {
  const [stats, setStats] = useState<Partial<Record<StatKey, number | null>>>({});
  useEffect(() => {
    if (!supabase) return;
    const db = supabase;
    const count = async (key: StatKey, build: () => PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count: n, error } = await build();
      setStats((s) => ({ ...s, [key]: error ? null : n }));
    };
    const head = { count: 'exact' as const, head: true };
    if (enabled.users) count('users', () => db.from('user_profiles').select('id', head).eq('is_active', true));
    if (enabled.students) count('activeStudents', () => db.from('students').select('id', head).eq('status', 'active'));
    if (enabled.finance) {
      const today = schoolToday();
      db.rpc('finance_collections', { p_from: today, p_to: today }).then(({ data, error }) =>
        setStats((s) => ({ ...s, collectedToday: error ? null : (data as { amount: number }[]).reduce((sum, r) => sum + Number(r.amount), 0) })),
      );
    }
    if (enabled.attendance) count('examsInReview', () => db.from('examinations').select('id', head).eq('status', 'under_review'));
    if (enabled.attendance) {
      db.rpc('attendance_overview', { p_date: schoolToday() }).then(({ data, error }) =>
        setStats((s) => ({ ...s, sectionsRecorded: error ? null : (data as { recorded: boolean }[]).filter((r) => r.recorded).length })),
      );
    }
    if (enabled.admissions) {
      count('newApplications', () => db.from('admission_applications').select('id', head).eq('status', 'submitted'));
      count('inReview', () => db.from('admission_applications').select('id', head).in('status', ['under_review', 'info_required']));
    }
    if (enabled.content) {
      const now = nowIso();
      count('publishedNotices', () =>
        db.from('notices').select('id', head).eq('status', 'published').lte('publish_at', now).or(`expires_at.is.null,expires_at.gt.${now}`),
      );
      count('draftNotices', () => db.from('notices').select('id', head).eq('status', 'draft'));
      count('upcomingEvents', () => db.from('events').select('id', head).eq('status', 'published').gte('starts_on', todayIso()));
      count('galleryItems', () => db.from('gallery_items').select('id', head).eq('status', 'published'));
      count('documents', () => db.from('downloadable_documents').select('id', head).eq('status', 'published'));
    }
  }, [enabled.content, enabled.users, enabled.admissions, enabled.students, enabled.attendance, enabled.finance]);
  return stats;
}

const STAT_META: { key: StatKey; icon: LucideIcon; to: string; group: 'users' | 'content' | 'admissions' | 'students' | 'attendance' | 'finance' }[] = [
  { key: 'collectedToday', icon: Wallet, to: '/admin/finance/payments', group: 'finance' },
  { key: 'activeStudents', icon: GraduationCap, to: '/admin/students', group: 'students' },
  { key: 'sectionsRecorded', icon: UserCheck, to: '/admin/attendance', group: 'attendance' },
  { key: 'examsInReview', icon: NotebookPen, to: '/admin/exams', group: 'attendance' },
  { key: 'newApplications', icon: ClipboardList, to: '/admin/admissions?status=submitted', group: 'admissions' },
  { key: 'inReview', icon: UserCheck, to: '/admin/admissions?status=under_review', group: 'admissions' },
  { key: 'users', icon: Users, to: '/admin/users', group: 'users' },
  { key: 'publishedNotices', icon: Megaphone, to: '/admin/content/notices?status=published', group: 'content' },
  { key: 'draftNotices', icon: NotebookPen, to: '/admin/content/notices?status=draft', group: 'content' },
  { key: 'upcomingEvents', icon: CalendarDays, to: '/admin/content/events', group: 'content' },
  { key: 'galleryItems', icon: Image, to: '/admin/content/gallery', group: 'content' },
  { key: 'documents', icon: FileText, to: '/admin/content/documents', group: 'content' },
];

const MODULES: { key: 'reports'; icon: LucideIcon; stage: number }[] = [
  { key: 'reports', icon: BarChart3, stage: 9 },
];

export default function DashboardPage() {
  const { t, lang, pick, formatDate } = useLang();
  const d = t.admin.dashboard;
  usePageMeta(d.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canContent = hasAnyRole(me, CONTENT_ROLES);
  const canUsers = hasAnyRole(me, USER_ADMIN_ROLES);
  const canAudit = hasAnyRole(me, AUDIT_ROLES);
  const canAdmissions = hasAnyRole(me, ADMISSION_VIEW_ROLES);
  const canStudents = hasAnyRole(me, STUDENT_VIEW_ROLES);
  const canAttendance = hasAnyRole(me, ATTENDANCE_VIEW_ROLES);
  const canFinance = hasAnyRole(me, FINANCE_VIEW_ROLES);
  const stats = useStats({ content: canContent, users: canUsers, admissions: canAdmissions, students: canStudents, attendance: canAttendance, finance: canFinance });
  const fmt = (n: number) => (lang === 'bn' ? toBnDigits(String(n)) : String(n));

  const recentNotices = useQuery<{ id: string; title_en: string | null; title_bn: string | null; status: 'draft' | 'published' | 'archived'; updated_at: string }[]>(
    (db) => db.from('notices').select('id,title_en,title_bn,status,updated_at').order('updated_at', { ascending: false }).limit(5),
    [],
  );
  const activity = useQuery<AuditRow[]>(
    (db) =>
      canAudit
        ? db.from('audit_logs').select('id,actor_id,action,table_name,record_id,changed_fields,created_at').order('created_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [], error: null }),
    [canAudit],
  );

  const allowed = { users: canUsers, admissions: canAdmissions, students: canStudents, content: canContent, attendance: canAttendance, finance: canFinance };
  const visibleStats = STAT_META.filter((s) => allowed[s.group]);

  return (
    <>
      <AdminPageHeader title={d.title} subtitle={d.welcome(me?.full_name || me?.email || '')} />

      {visibleStats.length > 0 && (
        <ul className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {visibleStats.map(({ key, icon: Icon, to }) => (
            <li key={key}>
              <Link to={to} className="block h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-royal-200 hover:shadow-md">
                <Icon className="h-5 w-5 text-royal-600" aria-hidden />
                <p className="mt-3 text-2xl font-bold text-navy-900">
                  {stats[key] === undefined && isBackendConfigured ? (
                    <span className="inline-block h-7 w-10 animate-pulse rounded bg-slate-100" />
                  ) : stats[key] == null ? (
                    '—'
                  ) : (
                    fmt(stats[key]!)
                  )}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">{d.stats[key]}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canContent && (
        <Panel title={d.quickActions} className="mb-6">
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/content/notices/new" className={buttonClass('primary')}>
              <Plus className="h-4 w-4" aria-hidden />
              {d.newNotice}
            </Link>
            <Link to="/admin/content/events/new" className={buttonClass('outline')}>
              <Plus className="h-4 w-4" aria-hidden />
              {d.newEvent}
            </Link>
            <Link to="/admin/content/gallery/new" className={buttonClass('outline')}>
              <Plus className="h-4 w-4" aria-hidden />
              {d.addPhoto}
            </Link>
          </div>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {canContent && (
          <Panel title={d.recentNotices}>
            <QueryView state={recentNotices.state} retry={recentNotices.retry} empty={t.common.emptyNotices}>
              {(rows) => (
                <ul className="divide-y divide-slate-100">
                  {rows.map((n) => (
                    <li key={n.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link to={`/admin/content/notices/${n.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-navy-900 hover:text-royal-700">
                        {pick(n.title_en, n.title_bn)}
                      </Link>
                      <StatusBadge status={n.status} />
                      <span className="hidden whitespace-nowrap text-xs text-slate-500 sm:inline">{formatDate(n.updated_at, { day: 'numeric', month: 'short' })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </QueryView>
          </Panel>
        )}
        {canAudit && (
          <Panel
            title={d.recentActivity}
            actions={
              <Link to="/admin/audit" className="text-sm font-semibold text-royal-700 hover:underline">
                {t.common.viewAll}
              </Link>
            }
          >
            <QueryView state={activity.state} retry={activity.retry} empty={d.noActivity}>
              {(rows) => <AuditTable rows={rows} compact />}
            </QueryView>
          </Panel>
        )}
      </div>

      <Panel title={d.modulesTitle} className="mt-6">
        <p className="mb-4 text-sm text-slate-600">{d.modulesNote}</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ key, icon: Icon, stage }) => (
            <li key={key} className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4 text-slate-500">
              <Icon className="h-5 w-5" aria-hidden />
              <span className="flex-1 text-sm font-medium">{d.modules[key]}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{d.stage(stage)}</span>
            </li>
          ))}
        </ul>
      </Panel>
      {!canContent && !canAudit && visibleStats.length === 0 && (
        <div className="mt-6">
          <EmptyState message={d.modulesNote} />
        </div>
      )}
    </>
  );
}
