import { Suspense, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, Languages, Loader2, LogOut, UserCircle, UserPlus } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { STAFF_ROLES, hasAnyRole } from '@/auth/roles';
import { RequireAuth } from '@/auth/guards';
import { supabase } from '@/integrations/supabase/client';
import { normalizeBdPhone, type Medium } from '@/lib/academics';
import { ATTENDANCE_STATUSES, STATUS_TONES, attendanceRate, monthRange, schoolToday, type AttendanceStatus } from '@/lib/attendance';
import { INVOICE_STATE_TONES, invoiceState, money, type InvoiceSummary, type Payment } from '@/lib/finance';
import { nowIso, type Notice } from '@/lib/content';
import { Container, EmptyState, Logo, QueryView, Spinner, buttonClass, cx } from '@/components/ui';
import { InlineNotice, Panel, TextField, ToastProvider, useToast } from '@/components/admin/adminUi';
import { useMediumLabel } from '@/components/admissions';
import { NoticeRow } from '@/components/content';
import { SectionTimetable } from '@/components/timetable/Timetable';
import { RESOURCE_SELECT, ResourceList, type LearningResource } from '@/components/resources/Resources';
import { ReportCard } from '@/components/exams/Results';
import { MonthInput } from '@/components/attendance/SectionSummary';

// ---------- Layout -----------------------------------------------------------------
function FamilyShell() {
  const { t, toggleLang } = useLang();
  const { me, initializing } = useAuth();
  const navigate = useNavigate();
  if (initializing) return <Spinner />;
  if (hasAnyRole(me, STAFF_ROLES)) return <Navigate to="/admin" replace />;
  if (hasAnyRole(me, ['teacher'])) return <Navigate to="/teacher" replace />;
  const isStudent = hasAnyRole(me, ['student']);
  const isGuardian = hasAnyRole(me, ['guardian']);

  const signOut = async () => {
    await supabase?.auth.signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="no-print sticky top-0 z-30 border-b border-gold-300/40 bg-navy-900 text-white shadow-sm">
        <Container className="flex items-center justify-between gap-3 py-3">
          <Link to="/portal" className="flex items-center gap-3">
            <Logo className="h-10 w-10 shrink-0" />
            <span>
              <span className="block text-sm font-bold">{t.meta.shortName}</span>
              <span className="block text-xs font-semibold text-gold-300">{isStudent && !isGuardian ? t.family.studentTitle : t.family.title}</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1" aria-label={t.family.title}>
            <Link to="/portal/account" className={buttonClass('ghost', 'px-2.5 text-white hover:bg-white/10')} aria-label={t.family.account}>
              <UserCircle className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{me?.full_name || t.family.account}</span>
            </Link>
            <button type="button" onClick={toggleLang} className={buttonClass('ghost', 'px-2.5 text-white hover:bg-white/10')} aria-label={t.switchAria}>
              <Languages className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t.switchLabel}</span>
            </button>
            <button type="button" onClick={signOut} className={buttonClass('ghost', 'px-2.5 text-white hover:bg-white/10')} aria-label={t.admin.menu.signOut}>
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </nav>
        </Container>
      </header>
      <main id="main">
        <Container className="py-6 sm:py-8">
          {isStudent || isGuardian ? (
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          ) : (
            <InlineNotice tone="warning">{t.portal.noRoles}</InlineNotice>
          )}
        </Container>
      </main>
    </div>
  );
}

export default function FamilyLayout() {
  return (
    <RequireAuth>
      <ToastProvider>
        <FamilyShell />
      </ToastProvider>
    </RequireAuth>
  );
}

// ---------- Shared data ---------------------------------------------------------------
interface ChildEnrollment {
  id: string;
  academic_year_id: string;
  class_id: string;
  medium: Medium;
  section_id: string | null;
  roll_no: number | null;
  status: string;
  class: { name_en: string; name_bn: string | null } | null;
  section: { name: string } | null;
  year: { name_en: string; name_bn: string | null; starts_on: string } | null;
}
interface Child {
  id: string;
  student_code: string;
  name_en: string;
  name_bn: string | null;
  medium: Medium;
  status: string;
  enrollments: ChildEnrollment[];
}

const CHILD_SELECT =
  'id,student_code,name_en,name_bn,medium,status,enrollments:student_enrollments(id,academic_year_id,class_id,medium,section_id,roll_no,status,' +
  'class:classes(name_en,name_bn),section:sections(name),year:academic_years(name_en,name_bn,starts_on))';

function currentEnrollment(c: Child) {
  return (
    c.enrollments.find((e) => e.status === 'enrolled') ??
    [...c.enrollments].sort((a, b) => (b.year?.starts_on ?? '').localeCompare(a.year?.starts_on ?? ''))[0]
  );
}

// ---------- Home -----------------------------------------------------------------------
export function FamilyHomePage() {
  const { t, pick } = useLang();
  const f = t.family;
  usePageMeta(f.title, undefined, { noindex: true });
  const { me } = useAuth();
  const mediumLabel = useMediumLabel();
  const isGuardian = hasAnyRole(me, ['guardian']);
  // RLS returns only the signed-in student, or the guardian's verified children.
  const children = useQuery<Child[]>((db) => db.from('students').select(CHILD_SELECT).order('name_en'), []);
  const notices = useQuery<Notice[]>(
    (db) =>
      db
        .from('notices')
        .select('id,title_en,title_bn,body_en,body_bn,category,publish_at,expires_at,attachment_path')
        .eq('status', 'published')
        .lte('publish_at', nowIso())
        .order('publish_at', { ascending: false })
        .limit(4),
    [],
  );

  if (!isGuardian && children.state.status === 'ready' && children.state.data.length === 1) {
    return <Navigate to={`/portal/s/${children.state.data[0].id}`} replace />;
  }

  return (
    <>
      <h1 className="heading mb-6 text-2xl font-bold text-navy-900">
        {t.portal.welcome}, {me?.full_name || me?.email}
      </h1>
      <h2 className="mb-3 text-lg font-semibold text-navy-900">{f.myChildren}</h2>
      <QueryView state={children.state} retry={children.retry} empty={f.noChildren}>
        {(rows) => (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((c) => {
              const e = currentEnrollment(c);
              return (
                <li key={c.id}>
                  <Link to={`/portal/s/${c.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-royal-200 hover:shadow-md">
                    <span>
                      <span className="block text-lg font-bold text-navy-900">{pick(c.name_en, c.name_bn)}</span>
                      <span className="block text-sm text-slate-600">
                        {e?.class ? pick(e.class.name_en, e.class.name_bn) : ''}
                        {e?.section && ` · ${e.section.name}`}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {c.student_code} · {mediumLabel(c.medium)}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 text-royal-600" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </QueryView>

      {isGuardian && <LinkRequestSection />}

      <Panel title={f.notices} className="mt-8">
        <QueryView state={notices.state} retry={notices.retry} empty={t.common.emptyNotices}>
          {(rows) => (
            <ul className="space-y-3">
              {rows.map((n) => (
                <NoticeRow key={n.id} notice={n} />
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

function LinkRequestSection() {
  const { t, formatDate } = useLang();
  const f = t.family;
  const toast = useToast();
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const requests = useQuery<{ id: string; student_code: string; status: string; created_at: string; review_note: string | null }[]>(
    (db) => db.from('guardian_link_requests').select('id,student_code,status,created_at,review_note').order('created_at', { ascending: false }).limit(10),
    [reload],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalized = normalizeBdPhone(phone);
    if (code.trim().length < 3 || relationship.trim().length < 2) return setError(t.admin.common.required);
    if (!normalized) return setError(t.apply.errors.phone);
    setBusy(true);
    const { error: err } = await supabase!
      .from('guardian_link_requests')
      .insert({ student_code: code.trim().toUpperCase(), guardian_phone: normalized, relationship: relationship.trim() });
    setBusy(false);
    if (err) return setError(err.message === 'TOO_MANY_REQUESTS' ? t.apply.serverErrors.TOO_MANY_REQUESTS : err.code === '23505' ? f.requestStatuses.pending : t.admin.common.saveFailed);
    toast('success', f.submitted);
    setCode('');
    setPhone('');
    setRelationship('');
    setReload((n) => n + 1);
  };

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <Panel title={f.requestLink}>
        <p className="mb-4 text-sm text-slate-600">{f.requestHelp}</p>
        <form onSubmit={submit} noValidate className="space-y-3">
          <TextField label={f.studentId} required value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} placeholder="KI20260001" />
          <TextField label={f.phone} required type="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} hint={t.apply.phoneHint} />
          <TextField label={f.relationship} required value={relationship} maxLength={50} list="relationship-options" onChange={(e) => setRelationship(e.target.value)} />
          <datalist id="relationship-options">
            {t.apply.relationshipSuggestions.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className={buttonClass('primary')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
            {f.submit}
          </button>
        </form>
      </Panel>
      <Panel title={f.myRequests}>
        <QueryView state={requests.state} retry={requests.retry} empty={t.admin.teacherPortal.none}>
          {(rows) => (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <strong className="font-mono text-navy-900">{r.student_code}</strong>
                    <span className="text-slate-500"> · {formatDate(r.created_at, { day: 'numeric', month: 'short' })}</span>
                    {r.review_note && <span className="block text-xs text-slate-500">{r.review_note}</span>}
                  </span>
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gold-100 text-gold-600',
                    )}
                  >
                    {f.requestStatuses[r.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>
    </div>
  );
}

// ---------- One student ------------------------------------------------------------------
type Tab = 'overview' | 'timetable' | 'attendance' | 'results' | 'fees' | 'resources';
const TABS: Tab[] = ['overview', 'timetable', 'attendance', 'results', 'fees', 'resources'];

export function ChildPage() {
  const { studentId = '' } = useParams();
  const { t, pick } = useLang();
  const f = t.family;
  const { me } = useAuth();
  const mediumLabel = useMediumLabel();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const child = useQuery<Child | null>((db) => db.from('students').select(CHILD_SELECT).eq('id', studentId).maybeSingle(), [studentId]);
  const c = child.state.status === 'ready' ? child.state.data : null;
  usePageMeta(c ? c.name_en : f.title, undefined, { noindex: true });
  const e = c ? currentEnrollment(c) : undefined;

  return (
    <>
      {hasAnyRole(me, ['guardian']) && (
        <Link to="/portal" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {f.myChildren}
        </Link>
      )}
      <QueryView state={child.state} retry={child.retry} empty={t.admin.common.noRecords} isEmpty={(d) => d === null}>
        {(x) =>
          x && (
            <>
              <div className="mb-5 rounded-2xl bg-navy-900 p-5 text-white sm:p-6">
                <h1 className="heading text-2xl font-bold">{pick(x.name_en, x.name_bn)}</h1>
                <p className="mt-1 text-sm text-navy-100">
                  {x.student_code} · {e?.class ? pick(e.class.name_en, e.class.name_bn) : ''}
                  {e?.section && ` · ${f.profile.section} ${e.section.name}`}
                  {e?.roll_no != null && ` · ${f.profile.roll} ${e.roll_no}`} · {mediumLabel(x.medium)}
                </p>
              </div>
              <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                {TABS.map((k) => (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    aria-selected={tab === k}
                    onClick={() => setParams({ tab: k }, { replace: true })}
                    className={cx('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold', tab === k ? 'bg-royal-600 text-white' : 'text-navy-700 hover:bg-navy-50')}
                  >
                    {f.tabs[k]}
                  </button>
                ))}
              </div>
              {tab === 'overview' && <Overview child={x} enrollment={e} onOpen={(k) => setParams({ tab: k }, { replace: true })} />}
              {tab === 'timetable' &&
                (e?.section_id ? (
                  <Panel>
                    <SectionTimetable sectionId={e.section_id} yearId={e.academic_year_id} />
                  </Panel>
                ) : (
                  <EmptyState message={f.noTimetable} />
                ))}
              {tab === 'attendance' && <AttendanceTab studentId={x.id} />}
              {tab === 'results' && <ResultsTab child={x} />}
              {tab === 'fees' && <FeesTab studentId={x.id} />}
              {tab === 'resources' && <ResourcesTab enrollment={e} />}
            </>
          )
        }
      </QueryView>
    </>
  );
}

function useMonthAttendance(studentId: string, month: string) {
  const { from, to } = monthRange(month + '-01');
  return useQuery<{ status: AttendanceStatus; note: string | null; session: { date: string } }[]>(
    (db) =>
      db
        .from('attendance_records')
        .select('status,note,session:attendance_sessions!inner(date)')
        .eq('student_id', studentId)
        .gte('session.date', from)
        .lte('session.date', to),
    [studentId, month],
  );
}

function Overview({ child, enrollment, onOpen }: { child: Child; enrollment?: ChildEnrollment; onOpen: (tab: Tab) => void }) {
  const { t, lang, pick } = useLang();
  const f = t.family;
  const mediumLabel = useMediumLabel();
  const month = schoolToday().slice(0, 7);
  const att = useMonthAttendance(child.id, month);
  const invoices = useQuery<InvoiceSummary[]>((db) => db.from('invoice_summaries').select('*').eq('student_id', child.id).eq('status', 'issued'), [child.id]);
  const rows = att.state.status === 'ready' ? att.state.data : [];
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<AttendanceStatus, number>;
  const rate = attendanceRate({ present: counts.present, late: counts.late, recorded_days: rows.length });
  const due = invoices.state.status === 'ready' ? invoices.state.data.reduce((s, i) => s + Math.max(0, Number(i.balance)), 0) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel title={t.admin.students.profile}>
        <dl className="space-y-2 text-sm">
          {[
            [f.profile.studentId, child.student_code],
            [f.profile.class, enrollment?.class ? pick(enrollment.class.name_en, enrollment.class.name_bn) : '—'],
            [f.profile.section, enrollment?.section?.name ?? '—'],
            [f.profile.roll, enrollment?.roll_no ?? '—'],
            [f.profile.medium, mediumLabel(child.medium)],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-3">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-navy-900">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel title={f.attendanceThisMonth}>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{att.state.status === 'loading' ? t.common.loading : f.noAttendance}</p>
        ) : (
          <>
            <p className="text-3xl font-bold text-navy-900">{rate === null ? '—' : `${rate}%`}</p>
            <p className="text-xs text-slate-500">{f.attendanceRate}</p>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {ATTENDANCE_STATUSES.map((s) => (
                <li key={s} className={cx('rounded-full border px-2 py-0.5 font-semibold', STATUS_TONES[s].on)}>
                  {t.admin.attendance.statuses[s]}: {counts[s]}
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" onClick={() => onOpen('attendance')} className="mt-4 text-sm font-semibold text-royal-700 hover:underline">
          {t.common.viewAll}
        </button>
      </Panel>
      <Panel title={f.feesBalance}>
        <p className={cx('text-3xl font-bold', due && due > 0 ? 'text-red-700' : 'text-emerald-700')}>{due === null ? '…' : money(due, lang)}</p>
        <button type="button" onClick={() => onOpen('fees')} className="mt-4 text-sm font-semibold text-royal-700 hover:underline">
          {t.common.viewAll}
        </button>
      </Panel>
    </div>
  );
}

function AttendanceTab({ studentId }: { studentId: string }) {
  const { t, formatDate } = useLang();
  const f = t.family;
  const [month, setMonth] = useState(schoolToday().slice(0, 7));
  const att = useMonthAttendance(studentId, month);
  const rows = att.state.status === 'ready' ? [...att.state.data].sort((a, b) => b.session.date.localeCompare(a.session.date)) : [];
  const present = rows.filter((r) => r.status === 'present').length;
  const late = rows.filter((r) => r.status === 'late').length;
  const rate = attendanceRate({ present, late, recorded_days: rows.length });
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="w-48">
          <MonthInput label={f.month} value={month} onChange={setMonth} />
        </div>
        {rate !== null && (
          <p className="text-sm text-slate-600">
            {f.attendanceRate}: <strong className="text-lg text-navy-900">{rate}%</strong>
          </p>
        )}
      </div>
      <QueryView state={att.state} retry={att.retry} empty={f.noAttendance}>
        {() => (
          <ul className="divide-y divide-slate-100 text-sm">
            {rows.map((r) => (
              <li key={r.session.date} className="flex items-center justify-between gap-3 py-2">
                <span className="text-navy-900">{formatDate(r.session.date + 'T00:00:00', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span className="flex items-center gap-2">
                  {r.note && <span className="text-xs text-slate-500">{r.note}</span>}
                  <span className={cx('rounded-full border px-2.5 py-0.5 text-xs font-semibold', STATUS_TONES[r.status].on)}>{t.admin.attendance.statuses[r.status]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

function ResultsTab({ child }: { child: Child }) {
  const { t, pick, formatDate } = useLang();
  const f = t.family;
  const yearIds = [...new Set(child.enrollments.map((e) => e.academic_year_id))];
  // RLS shows students and guardians only published examinations.
  const exams = useQuery<{ id: string; name_en: string; name_bn: string | null; ends_on: string | null }[]>(
    (db) =>
      yearIds.length
        ? db.from('examinations').select('id,name_en,name_bn,ends_on').eq('status', 'published').in('academic_year_id', yearIds).order('ends_on', { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
    [yearIds.join(',')],
  );
  return (
    <Panel title={f.results}>
      <QueryView state={exams.state} retry={exams.retry} empty={f.noResults}>
        {(rows) => (
          <ul className="divide-y divide-slate-100">
            {rows.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-semibold text-navy-900">{pick(x.name_en, x.name_bn)}</span>
                  {x.ends_on && <span className="block text-xs text-slate-500">{formatDate(x.ends_on + 'T00:00:00')}</span>}
                </span>
                <Link to={`/portal/s/${child.id}/report/${x.id}`} className={buttonClass('outline', 'px-3 py-1.5 text-xs')}>
                  <FileText className="h-4 w-4" aria-hidden />
                  {f.viewReportCard}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

function FeesTab({ studentId }: { studentId: string }) {
  const { t, lang, pick, formatDate } = useLang();
  const f = t.family;
  const fi = t.admin.finance;
  const invoices = useQuery<InvoiceSummary[]>(
    (db) => db.from('invoice_summaries').select('*').eq('student_id', studentId).order('due_date', { ascending: false }),
    [studentId],
  );
  const payments = useQuery<Payment[]>(
    (db) => db.from('payments').select('*').eq('student_id', studentId).order('paid_on', { ascending: false }),
    [studentId],
  );
  const due = invoices.state.status === 'ready' ? invoices.state.data.filter((i) => i.status === 'issued').reduce((s, i) => s + Math.max(0, Number(i.balance)), 0) : 0;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">{f.feesBalance}</p>
        <p className={cx('text-3xl font-bold', due > 0 ? 'text-red-700' : 'text-emerald-700')}>{money(due, lang)}</p>
        {due > 0 && <p className="mt-2 text-xs text-slate-500">{f.payAtOffice}</p>}
      </div>
      <Panel title={f.invoices}>
        <QueryView state={invoices.state} retry={invoices.retry} empty={f.noInvoices}>
          {(rows) => (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((i) => {
                const s = invoiceState(i);
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <span>
                      <span className="font-medium text-navy-900">{pick(i.title_en, i.title_bn)}</span>
                      <span className="block font-mono text-xs text-slate-400">
                        {i.invoice_no} · {fi.columns.due} {formatDate(i.due_date + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-right">
                        <span className="block font-semibold text-navy-900">{money(i.total, lang)}</span>
                        {s === 'partial' && <span className="block text-xs text-red-700">{fi.columns.balance}: {money(i.balance, lang)}</span>}
                      </span>
                      <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-semibold', INVOICE_STATE_TONES[s])}>{fi.invoiceStatus[s]}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryView>
      </Panel>
      <Panel title={f.payments}>
        <QueryView state={payments.state} retry={payments.retry} empty={f.noPayments}>
          {(rows) => (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((p) => (
                <li key={p.id} className={cx('flex flex-wrap items-center justify-between gap-3 py-2.5', p.status === 'reversed' && 'text-slate-400 line-through')}>
                  <span>
                    <span className="font-mono text-navy-900">{p.receipt_no}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDate(p.paid_on + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })} · {fi.methods[p.method]}
                    </span>
                  </span>
                  <span className="font-semibold">{money(p.amount, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>
    </div>
  );
}

function ResourcesTab({ enrollment }: { enrollment?: ChildEnrollment }) {
  const { t } = useLang();
  const list = useQuery<LearningResource[]>(
    (db) =>
      enrollment
        ? db
            .from('learning_resources')
            .select(RESOURCE_SELECT)
            .eq('academic_year_id', enrollment.academic_year_id)
            .eq('class_id', enrollment.class_id)
            .eq('medium', enrollment.medium)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    [enrollment?.id],
  );
  // Whole-class resources plus those for this child's own section.
  const rows = list.state.status === 'ready' ? list.state.data.filter((r) => !r.section_id || r.section_id === enrollment?.section_id) : [];
  return (
    <Panel>
      <QueryView state={list.state} retry={list.retry} empty={t.family.noResources} isEmpty={() => rows.length === 0}>
        {() => <ResourceList resources={rows} />}
      </QueryView>
    </Panel>
  );
}

export function FamilyReportCardPage() {
  const { studentId = '', examId = '' } = useParams();
  const { t } = useLang();
  usePageMeta(t.admin.exams.reportCard.title, undefined, { noindex: true });
  return (
    <>
      <Link to={`/portal/s/${studentId}?tab=results`} className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.family.back}
      </Link>
      <ReportCard examId={examId} studentId={studentId} />
    </>
  );
}
