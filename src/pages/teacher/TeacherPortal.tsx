import { Suspense, useState } from 'react';
import { Link, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, BookOpen, CalendarClock, ClipboardCheck, Eye, Languages, LogOut } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { hasAnyRole } from '@/auth/roles';
import { AccessDenied, RequireAuth } from '@/auth/guards';
import { useIdleSignOut } from '@/auth/useIdleSignOut';
import { supabase } from '@/integrations/supabase/client';
import { schoolToday, type AttendanceStatus } from '@/lib/attendance';
import type { Medium } from '@/lib/academics';
import { Container, EmptyState, Logo, QueryView, Spinner, buttonClass, cx } from '@/components/ui';
import { InlineNotice, Panel, ToastProvider, useToast } from '@/components/admin/adminUi';
import { useMediumLabel } from '@/components/admissions';
import AttendanceSheet from '@/components/attendance/AttendanceSheet';
import MarksEntry from '@/components/exams/MarksEntry';
import { ENTRY_SELECT, LessonCell, TimetableGrid, usePeriods, useSchoolDays, type TimetableEntry } from '@/components/timetable/Timetable';
import { AddResourceModal, RESOURCE_SELECT, ResourceList, type LearningResource, type ResourceTarget } from '@/components/resources/Resources';
import { ReportCard, ResultsTable } from '@/components/exams/Results';
import type { Exam } from '@/lib/exams';
import { MonthInput, SectionSummaryTable, useMonthRange } from '@/components/attendance/SectionSummary';
import { ExportCsvButton } from '@/components/reports/Reports';

function TeacherShell() {
  const { t, toggleLang } = useLang();
  const { me, initializing } = useAuth();
  const navigate = useNavigate();
  useIdleSignOut(hasAnyRole(me, ['teacher']));
  if (initializing) return <Spinner />;
  if (!hasAnyRole(me, ['teacher'])) return <AccessDenied />;

  const signOut = async () => {
    await supabase?.auth.signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="no-print sticky top-0 z-30 border-b border-royal-100 bg-white shadow-sm">
        <Container className="flex items-center justify-between gap-3 py-3">
          <Link to="/teacher" className="flex items-center gap-3">
            <Logo className="h-10 w-10 shrink-0" />
            <span>
              <span className="block text-sm font-bold text-navy-900">{t.meta.shortName}</span>
              <span className="block text-xs font-semibold text-royal-600">{t.admin.teacherPortal.title}</span>
            </span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="hidden text-sm text-slate-600 sm:inline">{me?.full_name || me?.email}</span>
            <button type="button" onClick={toggleLang} className={buttonClass('ghost', 'px-2.5')} aria-label={t.switchAria}>
              <Languages className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t.switchLabel}</span>
            </button>
            <button type="button" onClick={signOut} className={buttonClass('ghost', 'px-2.5')} aria-label={t.admin.menu.signOut}>
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t.admin.menu.signOut}</span>
            </button>
          </div>
        </Container>
      </header>
      <main id="main">
        <Container className="py-6 sm:py-8">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </Container>
      </main>
    </div>
  );
}

export default function TeacherLayout() {
  return (
    <RequireAuth>
      <ToastProvider>
        <TeacherShell />
      </ToastProvider>
    </RequireAuth>
  );
}

// ====================================================================
interface MyAssignment {
  id: string;
  role: 'class_teacher' | 'subject_teacher';
  section_id: string;
  section: {
    name: string;
    medium: Medium;
    year: { name_en: string; name_bn: string | null; starts_on: string; ends_on: string } | null;
    class: { name_en: string; name_bn: string | null; level: number } | null;
  } | null;
  subject: { name_en: string; name_bn: string | null } | null;
}

interface MyRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_status: AttendanceStatus;
  review_note: string | null;
  session: { date: string } | null;
  record: { student: { name_en: string; name_bn: string | null } | null } | null;
}

export function TeacherHomePage() {
  const { t, pick, formatDate } = useLang();
  const tp = t.admin.teacherPortal;
  const at = t.admin.attendance;
  usePageMeta(tp.title, undefined, { noindex: true });
  const { me } = useAuth();
  const mediumLabel = useMediumLabel();
  const today = schoolToday();

  const profile = useQuery<{ id: string; name_en: string; name_bn: string | null } | null>(
    (db) => db.from('teachers').select('id,name_en,name_bn').eq('user_id', me?.id ?? '').eq('is_active', true).maybeSingle(),
    [me?.id],
  );
  const assignments = useQuery<MyAssignment[]>(
    (db) =>
      db
        .from('teacher_assignments')
        .select('id,role,section_id,section:sections(name,medium,year:academic_years(name_en,name_bn,starts_on,ends_on),class:classes(name_en,name_bn,level)),subject:subjects(name_en,name_bn)'),
    [],
  );
  const current =
    assignments.state.status === 'ready'
      ? assignments.state.data
          .filter((a) => a.section?.year && a.section.year.starts_on <= today && a.section.year.ends_on >= today)
          .sort((a, b) => Number(b.role === 'class_teacher') - Number(a.role === 'class_teacher') || (a.section?.class?.level ?? 0) - (b.section?.class?.level ?? 0))
      : [];
  const sectionIds = [...new Set(current.map((a) => a.section_id))];
  const todaySessions = useQuery<{ section_id: string }[]>(
    (db) =>
      sectionIds.length
        ? db.from('attendance_sessions').select('section_id').eq('date', today).in('section_id', sectionIds)
        : Promise.resolve({ data: [], error: null }),
    [sectionIds.join(','), today],
  );
  const recordedToday = new Set(todaySessions.state.status === 'ready' ? todaySessions.state.data.map((s) => s.section_id) : []);
  const requests = useQuery<MyRequest[]>(
    (db) =>
      db
        .from('attendance_correction_requests')
        .select('id,status,requested_status,review_note,session:attendance_sessions(date),record:attendance_records(student:students(name_en,name_bn))')
        .eq('requested_by', me?.id ?? '')
        .order('requested_at', { ascending: false })
        .limit(10),
    [me?.id],
  );

  if (profile.state.status === 'loading') return <Spinner />;
  if (profile.state.status === 'ready' && !profile.state.data) return <InlineNotice tone="warning">{tp.notLinked}</InlineNotice>;
  const name = profile.state.status === 'ready' && profile.state.data ? pick(profile.state.data.name_en, profile.state.data.name_bn) : '';

  return (
    <>
      <div className="mb-6">
        <p className="text-sm text-slate-500">{t.portal.welcome}</p>
        <h1 className="heading text-2xl font-bold text-navy-900">{name}</h1>
        <p className="text-sm text-slate-500">
          {tp.today}: {formatDate(today + 'T00:00:00', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-navy-900">{tp.myClasses}</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/teacher/timetable" className={buttonClass('outline', 'px-3 py-1.5 text-xs')}>
            <CalendarClock className="h-4 w-4" aria-hidden />
            {tp.timetable}
          </Link>
          <Link to="/teacher/exams" className={buttonClass('outline', 'px-3 py-1.5 text-xs')}>
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            {tp.exams}
          </Link>
          <Link to="/teacher/resources" className={buttonClass('outline', 'px-3 py-1.5 text-xs')}>
            <BookOpen className="h-4 w-4" aria-hidden />
            {tp.resources}
          </Link>
        </div>
      </div>
      <QueryView state={assignments.state} retry={assignments.retry} empty={tp.noAssignments} isEmpty={() => current.length === 0}>
        {() => (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {current.map((a) => {
              const isCT = a.role === 'class_teacher';
              const done = recordedToday.has(a.section_id);
              return (
                <li key={a.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="heading text-lg font-bold text-navy-900">
                        {a.section?.class ? pick(a.section.class.name_en, a.section.class.name_bn) : ''} · {a.section?.name}
                      </p>
                      <p className="text-xs text-slate-500">{a.section && mediumLabel(a.section.medium)}</p>
                    </div>
                    <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', isCT ? 'bg-navy-900 text-white' : 'bg-royal-50 text-royal-700')}>
                      {t.admin.teachers.roles[a.role]}
                    </span>
                  </div>
                  {a.subject && <p className="mt-2 text-sm text-slate-700">{pick(a.subject.name_en, a.subject.name_bn)}</p>}
                  {isCT && (
                    <p className={cx('mt-3 text-sm font-semibold', done ? 'text-emerald-700' : 'text-gold-600')}>
                      {tp.today}: {done ? tp.recorded : tp.notRecorded}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <Link to={`/teacher/attendance/${a.section_id}`} className={buttonClass(isCT && !done ? 'primary' : 'outline', 'px-3 py-1.5 text-xs')}>
                      {isCT ? <ClipboardCheck className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                      {isCT ? tp.take : tp.view}
                    </Link>
                    <Link to={`/teacher/summary/${a.section_id}`} className={buttonClass('ghost', 'px-3 py-1.5 text-xs')}>
                      <BarChart3 className="h-4 w-4" aria-hidden />
                      {tp.summary}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryView>

      <Panel title={tp.myRequests} className="mt-8">
        <QueryView state={requests.state} retry={requests.retry} empty={tp.none}>
          {(rows) => (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <strong className="text-navy-900">{r.record?.student ? pick(r.record.student.name_en, r.record.student.name_bn) : '—'}</strong>
                    <span className="text-slate-500">
                      {' '}
                      · {r.session && formatDate(r.session.date + 'T00:00:00', { day: 'numeric', month: 'short' })} → {at.statuses[r.requested_status]}
                    </span>
                    {r.review_note && <span className="block text-xs text-slate-500">{r.review_note}</span>}
                  </span>
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      r.status === 'pending' ? 'bg-gold-100 text-gold-600' : r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700',
                    )}
                  >
                    {at.corrections.statuses[r.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

function BackLink() {
  const { t } = useLang();
  return (
    <Link to="/teacher" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t.admin.teacherPortal.back}
    </Link>
  );
}

export function TeacherSheetPage() {
  const { sectionId = '' } = useParams();
  const { t } = useLang();
  usePageMeta(t.admin.attendance.sheetTitle, undefined, { noindex: true });
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || schoolToday();
  if (!sectionId) return <EmptyState message={t.admin.common.noRecords} />;
  return (
    <>
      <BackLink />
      <AttendanceSheet sectionId={sectionId} date={date} mode="teacher" onDateChange={(d) => setParams({ date: d }, { replace: true })} />
    </>
  );
}

// ====================================================================
interface TeacherExamAssignment {
  role: 'class_teacher' | 'subject_teacher';
  section_id: string;
  subject_id: string | null;
  section: { name: string; class_id: string; medium: Medium; academic_year_id: string; class: { name_en: string; name_bn: string | null; level: number } | null } | null;
  subject: { name_en: string; name_bn: string | null } | null;
}

export function TeacherExamsPage() {
  const { t, pick } = useLang();
  const tp = t.admin.teacherPortal;
  usePageMeta(tp.exams, undefined, { noindex: true });
  const mediumLabel = useMediumLabel();
  const assignments = useQuery<TeacherExamAssignment[]>(
    (db) =>
      db
        .from('teacher_assignments')
        .select('role,section_id,subject_id,section:sections(name,class_id,medium,academic_year_id,class:classes(name_en,name_bn,level)),subject:subjects(name_en,name_bn)'),
    [],
  );
  const yearIds = assignments.state.status === 'ready' ? [...new Set(assignments.state.data.map((a) => a.section?.academic_year_id).filter(Boolean))] : [];
  const exams = useQuery<(Exam & { subjects: { id: string; class_id: string; medium: Medium; subject_id: string }[] })[]>(
    (db) =>
      yearIds.length
        ? db
            .from('examinations')
            .select('*,subjects:examination_subjects(id,class_id,medium,subject_id)')
            .in('academic_year_id', yearIds as string[])
            .neq('status', 'draft')
            .order('starts_on', { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
    [yearIds.join(',')],
  );
  const rows = assignments.state.status === 'ready' ? assignments.state.data : [];
  const label = (a: TeacherExamAssignment) =>
    `${a.section?.class ? pick(a.section.class.name_en, a.section.class.name_bn) : ''} · ${a.section?.name ?? ''} (${a.section ? mediumLabel(a.section.medium) : ''})`;

  return (
    <>
      <BackLink />
      <h1 className="heading text-2xl font-bold text-navy-900">{tp.exams}</h1>
      <p className="mb-6 text-sm text-slate-600">{tp.examsHelp}</p>
      <QueryView state={exams.state} retry={exams.retry} empty={tp.noExams}>
        {(list) => (
          <div className="space-y-6">
            {list.map((ex) => {
              const subjectRows = rows
                .filter((a) => a.role === 'subject_teacher' && a.section?.academic_year_id === ex.academic_year_id)
                .map((a) => ({ a, es: ex.subjects.find((s) => s.class_id === a.section?.class_id && s.medium === a.section?.medium && s.subject_id === a.subject_id) }))
                .filter((x) => x.es);
              const ctRows = rows.filter((a) => a.role === 'class_teacher' && a.section?.academic_year_id === ex.academic_year_id);
              if (subjectRows.length === 0 && ctRows.length === 0) return null;
              return (
                <Panel key={ex.id} title={pick(ex.name_en, ex.name_bn)} actions={<span className="text-xs font-semibold text-royal-700">{t.admin.exams.statuses[ex.status]}</span>}>
                  <ul className="divide-y divide-slate-100">
                    {subjectRows.map(({ a, es }) => (
                      <li key={es!.id + a.section_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span className="text-sm">
                          <strong className="text-navy-900">{a.subject ? pick(a.subject.name_en, a.subject.name_bn) : ''}</strong>
                          <span className="text-slate-500"> · {label(a)}</span>
                        </span>
                        <Link to={`/teacher/marks/${es!.id}/${a.section_id}`} className={buttonClass(ex.status === 'marks_entry' ? 'primary' : 'outline', 'px-3 py-1.5 text-xs')}>
                          <ClipboardCheck className="h-4 w-4" aria-hidden />
                          {ex.status === 'marks_entry' ? tp.enterMarks : tp.viewMarks}
                        </Link>
                      </li>
                    ))}
                    {ctRows.map((a) => (
                      <li key={'ct' + a.section_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span className="text-sm text-navy-900">
                          {tp.results} · {label(a)}
                        </span>
                        <Link to={`/teacher/results/${ex.id}/${a.section_id}`} className={buttonClass('ghost', 'px-3 py-1.5 text-xs')}>
                          <BarChart3 className="h-4 w-4" aria-hidden />
                          {tp.results}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })}
          </div>
        )}
      </QueryView>
    </>
  );
}

export function TeacherMarksPage() {
  const { examSubjectId = '', sectionId = '' } = useParams();
  const { t } = useLang();
  usePageMeta(t.admin.teacherPortal.enterMarks, undefined, { noindex: true });
  return (
    <>
      <Link to="/teacher/exams" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.teacherPortal.exams}
      </Link>
      <MarksEntry examSubjectId={examSubjectId} sectionId={sectionId} mode="teacher" />
    </>
  );
}

export function TeacherResultsPage() {
  const { examId = '', sectionId = '' } = useParams();
  const { t } = useLang();
  usePageMeta(t.admin.teacherPortal.results, undefined, { noindex: true });
  const toast = useToast();
  return (
    <>
      <Link to="/teacher/exams" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.teacherPortal.exams}
      </Link>
      <Panel
        title={t.admin.teacherPortal.results}
        actions={
          <ExportCsvButton
            kind="exam_results"
            params={{ exam: examId, section: sectionId }}
            fileBase={t.admin.reports.kinds.exam_results.file}
            onError={(m) => toast('error', m)}
          />
        }
      >
        <ResultsTable examId={examId} sectionId={sectionId} reportLink={(sid) => `/teacher/report/${examId}/${sid}`} />
      </Panel>
    </>
  );
}

export function TeacherReportCardPage() {
  const { examId = '', studentId = '' } = useParams();
  const { t } = useLang();
  usePageMeta(t.admin.exams.reportCard.title, undefined, { noindex: true });
  return (
    <>
      <button type="button" onClick={() => window.history.back()} className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.common.back}
      </button>
      <ReportCard examId={examId} studentId={studentId} />
    </>
  );
}

/** The current academic year (the one containing today), for portal views. */
function useCurrentYearId() {
  const years = useQuery<{ id: string; starts_on: string; ends_on: string; is_current: boolean }[]>(
    (db) => db.from('academic_years').select('id,starts_on,ends_on,is_current'),
    [],
  );
  const today = schoolToday();
  const list = years.state.status === 'ready' ? years.state.data : [];
  return (list.find((y) => y.starts_on <= today && y.ends_on >= today) ?? list.find((y) => y.is_current))?.id ?? '';
}

export function TeacherTimetablePage() {
  const { t } = useLang();
  usePageMeta(t.admin.teacherPortal.timetable, undefined, { noindex: true });
  const { me } = useAuth();
  const yearId = useCurrentYearId();
  const days = useSchoolDays();
  const periods = usePeriods(yearId);
  const profile = useQuery<{ id: string } | null>(
    (db) => db.from('teachers').select('id').eq('user_id', me?.id ?? '').maybeSingle(),
    [me?.id],
  );
  const teacherId = profile.state.status === 'ready' ? profile.state.data?.id : undefined;
  const entries = useQuery<TimetableEntry[]>(
    (db) =>
      teacherId && yearId
        ? db.from('timetable_entries').select(ENTRY_SELECT).eq('teacher_id', teacherId).eq('academic_year_id', yearId)
        : Promise.resolve({ data: [], error: null }),
    [teacherId, yearId],
  );
  const map = new Map((entries.state.status === 'ready' ? entries.state.data : []).map((e) => [`${e.weekday}:${e.period_no}`, e]));
  return (
    <>
      <BackLink />
      <Panel title={t.admin.teacherPortal.timetable}>
        <QueryView state={periods.state} retry={periods.retry} empty={t.family.noTimetable}>
          {(p) => <TimetableGrid periods={p} days={days} cell={(d, n) => <LessonCell entry={map.get(`${d}:${n}`)} showSection showTeacher={false} />} />}
        </QueryView>
      </Panel>
    </>
  );
}

export function TeacherResourcesPage() {
  const { t, pick } = useLang();
  const r = t.admin.resources;
  usePageMeta(r.title, undefined, { noindex: true });
  const { me } = useAuth();
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);
  const assignments = useQuery<TeacherExamAssignment[]>(
    (db) =>
      db
        .from('teacher_assignments')
        .select('role,section_id,subject_id,section:sections(name,class_id,medium,academic_year_id,class:classes(name_en,name_bn,level)),subject:subjects(name_en,name_bn)'),
    [],
  );
  const targets: ResourceTarget[] = [];
  const seen = new Set<string>();
  for (const a of assignments.state.status === 'ready' ? assignments.state.data : []) {
    if (!a.section || seen.has(a.section_id)) continue;
    seen.add(a.section_id);
    targets.push({
      value: a.section_id,
      label: `${a.section.class ? pick(a.section.class.name_en, a.section.class.name_bn) : ''} · ${a.section.name} (${mediumLabel(a.section.medium)})`,
      yearId: a.section.academic_year_id,
      classId: a.section.class_id,
      medium: a.section.medium,
      sectionId: a.section_id,
    });
  }
  const sectionIds = targets.map((x) => x.value);
  const list = useQuery<LearningResource[]>(
    (db) =>
      sectionIds.length
        ? db.from('learning_resources').select(RESOURCE_SELECT).in('section_id', sectionIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    [sectionIds.join(','), reload],
  );
  return (
    <>
      <BackLink />
      <Panel
        title={r.title}
        actions={
          targets.length > 0 && (
            <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary', 'px-3 py-1.5 text-xs')}>
              {r.add}
            </button>
          )
        }
      >
        <p className="mb-3 text-xs text-slate-500">{r.teacherHint}</p>
        <QueryView state={list.state} retry={list.retry} empty={t.family.noResources}>
          {(rows) => <ResourceList resources={rows} showClass canDelete={(x) => x.uploaded_by === me?.id} onDeleted={() => setReload((n) => n + 1)} />}
        </QueryView>
      </Panel>
      <AddResourceModal
        open={adding}
        targets={targets}
        onClose={() => setAdding(false)}
        onDone={() => {
          setAdding(false);
          toast('success', t.admin.common.saved);
          setReload((n) => n + 1);
        }}
      />
    </>
  );
}

export function TeacherSummaryPage() {
  const { sectionId = '' } = useParams();
  const { t } = useLang();
  const tp = t.admin.teacherPortal;
  usePageMeta(tp.summaryTitle, undefined, { noindex: true });
  const { month, setMonth, from, to } = useMonthRange();
  const toast = useToast();
  return (
    <>
      <BackLink />
      <Panel
        title={tp.summaryTitle}
        actions={
          <ExportCsvButton
            kind="attendance_summary"
            params={{ section: sectionId, from, to }}
            fileBase={t.admin.reports.kinds.attendance_summary.file}
            onError={(m) => toast('error', m)}
          />
        }
      >
        <div className="no-print mb-5 max-w-xs">
          <MonthInput label={t.admin.attendance.date} value={month} onChange={setMonth} />
        </div>
        <SectionSummaryTable sectionId={sectionId} from={from} to={to} />
      </Panel>
    </>
  );
}
