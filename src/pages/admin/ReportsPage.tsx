import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  CalendarX,
  ClipboardList,
  Coins,
  Loader2,
  NotebookPen,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth, type AppRole } from '@/auth/AuthProvider';
import {
  ADMISSION_VIEW_ROLES,
  ATTENDANCE_VIEW_ROLES,
  EXAM_VIEW_ROLES,
  FINANCE_VIEW_ROLES,
  STUDENT_VIEW_ROLES,
  hasAnyRole,
} from '@/auth/roles';
import { APPLICATION_STATUSES, MEDIUMS, useClassOfferings, useSections, type AcademicYear, type Medium } from '@/lib/academics';
import { monthRange, schoolToday } from '@/lib/attendance';
import { QueryView, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, InlineNotice, Panel } from '@/components/admin/adminUi';
import { useMediumLabel } from '@/components/admissions';
import {
  PrintLetterhead,
  ReportActions,
  ReportTable,
  downloadReportCsv,
  reportError,
  runReport,
  useReportColumns,
  type ReportKind,
  type ReportResult,
} from '@/components/reports/Reports';
import { sortSections, useYearSections } from './AttendanceAdminPages';

const CATALOG: { kind: ReportKind; icon: LucideIcon; roles: AppRole[] }[] = [
  { kind: 'students', icon: Users, roles: STUDENT_VIEW_ROLES },
  { kind: 'admissions', icon: ClipboardList, roles: ADMISSION_VIEW_ROLES },
  { kind: 'attendance_summary', icon: BarChart3, roles: ATTENDANCE_VIEW_ROLES },
  { kind: 'attendance_absences', icon: CalendarX, roles: ATTENDANCE_VIEW_ROLES },
  { kind: 'exam_results', icon: NotebookPen, roles: EXAM_VIEW_ROLES },
  { kind: 'fee_collections', icon: Wallet, roles: FINANCE_VIEW_ROLES },
  { kind: 'fee_outstanding', icon: Coins, roles: FINANCE_VIEW_ROLES },
];

/** Wide reports print on landscape pages. */
const LANDSCAPE: ReportKind[] = ['students', 'admissions', 'exam_results', 'fee_collections'];

interface Filters {
  year: string;
  class: string;
  medium: Medium | '';
  section: string;
  status: string;
  from: string;
  to: string;
  min: number;
  exam: string;
}

interface ExamOption {
  id: string;
  name_en: string;
  name_bn: string | null;
  academic_year_id: string;
}

export default function ReportsPage() {
  const { t, pick, formatDate } = useLang();
  const r = t.admin.reports;
  usePageMeta(r.title, undefined, { noindex: true });
  const { me } = useAuth();
  const mediumLabel = useMediumLabel();
  const columnsFor = useReportColumns();
  const [params, setParams] = useSearchParams();
  const available = CATALOG.filter((c) => hasAnyRole(me, c.roles));
  const kind = available.find((c) => c.kind === params.get('report'))?.kind ?? null;

  const month = monthRange(schoolToday());
  const [f, setF] = useState<Filters>({
    year: '',
    class: '',
    medium: '',
    section: '',
    status: '',
    from: month.from,
    to: month.to,
    min: 3,
    exam: '',
  });
  const set = (patch: Partial<Filters>) => setF((prev) => ({ ...prev, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: ReportKind; data: ReportResult; lines: string[] } | null>(null);

  const years = useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
  const offerings = useClassOfferings();
  const exams = useQuery<ExamOption[]>(
    (db) => (kind === 'exam_results' ? db.from('examinations').select('id,name_en,name_bn,academic_year_id').order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null })),
    [kind],
  );
  const exam = exams.state.status === 'ready' ? exams.state.data.find((e) => e.id === f.exam) : undefined;
  const yearSections = useYearSections(kind === 'exam_results' ? (exam?.academic_year_id ?? '') : f.year);
  const classSections = useSections(f.year, f.class, f.medium);

  useEffect(() => {
    if (!f.year && years.state.status === 'ready' && years.state.data.length) {
      set({ year: (years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id });
    }
  }, [years.state, f.year]);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [kind]);

  const choose = (k: ReportKind) => {
    const next = new URLSearchParams(params);
    next.set('report', k);
    setParams(next, { replace: true });
  };

  const yearName = () => {
    const y = years.state.status === 'ready' ? years.state.data.find((x) => x.id === f.year) : undefined;
    return y ? pick(y.name_en, y.name_bn) : '';
  };
  const className = () => {
    const c = offerings.state.status === 'ready' ? offerings.state.data.find((x) => x.id === f.class) : undefined;
    return c ? pick(c.name_en, c.name_bn) : '';
  };
  const sectionName = () => {
    const s = yearSections.state.status === 'ready' ? yearSections.state.data.find((x) => x.id === f.section) : undefined;
    return s ? `${s.class ? pick(s.class.name_en, s.class.name_bn) : ''} · ${s.name} (${mediumLabel(s.medium)})` : '';
  };
  const range = () =>
    `${formatDate(f.from + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDate(f.to + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const request = (): { params: Record<string, string | number>; lines: string[] } | null => {
    switch (kind) {
      case 'students':
        return {
          params: { year: f.year, class: f.class, medium: f.medium, section: f.section, status: f.status },
          lines: [yearName(), className(), f.medium && mediumLabel(f.medium), f.status && t.admin.students.statuses[f.status as keyof typeof t.admin.students.statuses]].filter(Boolean) as string[],
        };
      case 'admissions':
        return {
          params: { year: f.year, status: f.status },
          lines: [yearName(), f.status && t.applicationStatuses[f.status as keyof typeof t.applicationStatuses]].filter(Boolean) as string[],
        };
      case 'attendance_summary':
        return f.section ? { params: { section: f.section, from: f.from, to: f.to }, lines: [sectionName(), range()] } : null;
      case 'attendance_absences':
        return { params: { from: f.from, to: f.to, min_absences: Math.max(1, f.min) }, lines: [range(), r.minAbsencesLine(Math.max(1, f.min))] };
      case 'exam_results':
        return f.exam && f.section
          ? { params: { exam: f.exam, section: f.section }, lines: [exam ? pick(exam.name_en, exam.name_bn) : '', sectionName()] }
          : null;
      case 'fee_collections':
        return { params: { from: f.from, to: f.to }, lines: [range()] };
      case 'fee_outstanding':
        return { params: { year: f.year, class: f.class }, lines: [yearName(), className() || r.filters.allClasses] };
      default:
        return null;
    }
  };

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    const req = request();
    if (!req) return setError(r.errors.INVALID_PARAMS);
    setBusy(true);
    setError(null);
    const res = await runReport(kind, req.params);
    setBusy(false);
    if (!res.ok) {
      setResult(null);
      return setError(reportError(t, res.code));
    }
    setResult({ kind, data: res.data, lines: req.lines });
  };

  const label = (text: string, control: ReactNode) => (
    <label className="text-sm font-semibold text-navy-800">
      {text}
      {control}
    </label>
  );
  const yearSelect = () =>
    label(
      r.filters.year,
      <select value={f.year} onChange={(e) => set({ year: e.target.value, section: '' })} className={inputClass + ' mt-1.5'}>
        {years.state.status === 'ready' &&
          years.state.data.map((y) => (
            <option key={y.id} value={y.id}>
              {pick(y.name_en, y.name_bn)}
            </option>
          ))}
      </select>,
    );
  const classSelect = () =>
    label(
      r.filters.class,
      <select value={f.class} onChange={(e) => set({ class: e.target.value, section: '' })} className={inputClass + ' mt-1.5'}>
        <option value="">{r.filters.allClasses}</option>
        {offerings.state.status === 'ready' &&
          offerings.state.data.map((c) => (
            <option key={c.id} value={c.id}>
              {pick(c.name_en, c.name_bn)}
            </option>
          ))}
      </select>,
    );
  const yearSectionSelect = () =>
    label(
      r.filters.section,
      <select value={f.section} onChange={(e) => set({ section: e.target.value })} className={inputClass + ' mt-1.5'} required>
        <option value="">{r.filters.selectSection}</option>
        {yearSections.state.status === 'ready' &&
          sortSections(yearSections.state.data).map((s) => (
            <option key={s.id} value={s.id}>
              {s.class ? pick(s.class.name_en, s.class.name_bn) : ''} · {s.name} ({mediumLabel(s.medium)})
            </option>
          ))}
      </select>,
    );
  const dates = () => (
    <>
      {label(r.filters.from, <input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ from: e.target.value })} className={inputClass + ' mt-1.5'} />)}
      {label(r.filters.to, <input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && set({ to: e.target.value })} className={inputClass + ' mt-1.5'} />)}
    </>
  );

  const columns = result ? columnsFor(result.kind, result.data) : [];
  const title = kind ? r.kinds[kind].title : '';

  return (
    <>
      <div className="no-print">
        <AdminPageHeader title={r.title} subtitle={r.subtitle} />
        <InlineNotice>{r.auditNote}</InlineNotice>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {available.map(({ kind: k, icon: Icon }) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => choose(k)}
                aria-pressed={kind === k}
                className={cx(
                  'flex h-full w-full flex-col items-start gap-2 rounded-xl border p-4 text-left transition',
                  kind === k ? 'border-royal-500 bg-royal-50 ring-2 ring-royal-200' : 'border-slate-200 bg-white hover:border-royal-300',
                )}
              >
                <Icon className="h-5 w-5 text-royal-600" aria-hidden />
                <span className="text-sm font-semibold text-navy-900">{r.kinds[k].title}</span>
                <span className="text-xs text-slate-600">{r.kinds[k].description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {kind && (
        <Panel title={title} className="no-print mt-6">
          <form onSubmit={run} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            {kind === 'students' && (
              <>
                {yearSelect()}
                {classSelect()}
                {label(
                  r.filters.medium,
                  <select value={f.medium} onChange={(e) => set({ medium: e.target.value as Medium | '', section: '' })} className={inputClass + ' mt-1.5'}>
                    <option value="">{r.filters.allMediums}</option>
                    {MEDIUMS.map((m) => (
                      <option key={m} value={m}>
                        {mediumLabel(m)}
                      </option>
                    ))}
                  </select>,
                )}
                {label(
                  r.filters.section,
                  <select
                    value={f.section}
                    onChange={(e) => set({ section: e.target.value })}
                    disabled={!f.class || !f.medium}
                    className={inputClass + ' mt-1.5 disabled:bg-slate-50'}
                  >
                    <option value="">{r.filters.allSections}</option>
                    {classSections.state.status === 'ready' &&
                      classSections.state.data.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>,
                )}
                {label(
                  r.filters.status,
                  <select value={f.status} onChange={(e) => set({ status: e.target.value })} className={inputClass + ' mt-1.5'}>
                    <option value="">{r.filters.allStatuses}</option>
                    {Object.entries(t.admin.students.statuses).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>,
                )}
              </>
            )}
            {kind === 'admissions' && (
              <>
                {yearSelect()}
                {label(
                  r.filters.status,
                  <select value={f.status} onChange={(e) => set({ status: e.target.value })} className={inputClass + ' mt-1.5'}>
                    <option value="">{r.filters.allStatuses}</option>
                    {APPLICATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t.applicationStatuses[s]}
                      </option>
                    ))}
                  </select>,
                )}
              </>
            )}
            {kind === 'attendance_summary' && (
              <>
                {yearSelect()}
                {yearSectionSelect()}
                {dates()}
              </>
            )}
            {kind === 'attendance_absences' && (
              <>
                {dates()}
                {label(
                  r.filters.minAbsences,
                  <input type="number" min={1} value={f.min} onChange={(e) => set({ min: Number(e.target.value) })} className={inputClass + ' mt-1.5'} />,
                )}
              </>
            )}
            {kind === 'exam_results' && (
              <>
                {label(
                  r.filters.exam,
                  <select value={f.exam} onChange={(e) => set({ exam: e.target.value, section: '' })} className={inputClass + ' mt-1.5'} required>
                    <option value="">{r.filters.selectExam}</option>
                    {exams.state.status === 'ready' &&
                      exams.state.data.map((x) => (
                        <option key={x.id} value={x.id}>
                          {pick(x.name_en, x.name_bn)}
                        </option>
                      ))}
                  </select>,
                )}
                {yearSectionSelect()}
              </>
            )}
            {kind === 'fee_collections' && dates()}
            {kind === 'fee_outstanding' && (
              <>
                {yearSelect()}
                {classSelect()}
              </>
            )}
            <button type="submit" disabled={busy} className={buttonClass('primary')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy ? r.running : r.run}
            </button>
          </form>
          {kind === 'fee_collections' && <p className="mt-3 text-xs text-slate-500">{r.reversedNote}</p>}
          {kind === 'attendance_summary' || kind === 'attendance_absences' || kind === 'fee_collections' ? (
            <p className="mt-1 text-xs text-slate-500">{r.rangeNote}</p>
          ) : null}
          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
        </Panel>
      )}

      {result && (
        <section className={cx('mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:mt-0 print:border-0 print:p-0 print:shadow-none sm:p-6', LANDSCAPE.includes(result.kind) && 'print-landscape')}>
          <PrintLetterhead title={r.kinds[result.kind].title} lines={result.lines} />
          <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-navy-900">{r.kinds[result.kind].title}</h2>
              <p className="text-xs text-slate-500">
                {result.lines.filter(Boolean).join(' · ')} · {r.rows(result.data.rows.length)}
              </p>
            </div>
            {result.data.rows.length > 0 && (
              <ReportActions onCsv={() => downloadReportCsv(columns, result.data.rows, r.kinds[result.kind].file)} />
            )}
          </div>
          <QueryView state={{ status: 'ready', data: result.data.rows, count: null }} retry={() => {}} empty={r.empty}>
            {(rows) => <ReportTable columns={columns} rows={rows} />}
          </QueryView>
        </section>
      )}
    </>
  );
}
