import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Pencil, Plus, Printer, Trash2, X } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { schoolToday, addDays, type AttendanceStatus } from '@/lib/attendance';
import type { AcademicYear, Medium } from '@/lib/academics';
import { QueryView, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, Panel, useToast } from '@/components/admin/adminUi';
import { EntityModal, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { useMediumLabel } from '@/components/admissions';
import AttendanceSheet, { attendanceError } from '@/components/attendance/AttendanceSheet';
import { MonthInput, SectionSummaryTable, useMonthRange } from '@/components/attendance/SectionSummary';
import { useActorNames } from './AuditPage';

interface OverviewRow {
  section_id: string;
  section_name: string;
  class_name_en: string;
  class_name_bn: string | null;
  class_level: number;
  medium: Medium;
  on_roll: number;
  recorded: boolean;
  present: number;
  absent: number;
  late: number;
  on_leave: number;
}

export interface YearSection {
  id: string;
  name: string;
  class_id: string;
  medium: Medium;
  class: { name_en: string; name_bn: string | null; level: number } | null;
}

/** All sections of an academic year, ordered by class level, stream and name. */
export function useYearSections(yearId: string) {
  return useQuery<YearSection[]>(
    (db) =>
      yearId
        ? db.from('sections').select('id,name,class_id,medium,class:classes(name_en,name_bn,level)').eq('academic_year_id', yearId)
        : Promise.resolve({ data: [], error: null }),
    [yearId],
  );
}

export function sortSections(rows: YearSection[]) {
  return [...rows].sort(
    (a, b) => (a.class?.level ?? 0) - (b.class?.level ?? 0) || a.medium.localeCompare(b.medium) || a.name.localeCompare(b.name),
  );
}

// ====================================================================
export function AttendanceOverviewPage() {
  const { t, pick } = useLang();
  const at = t.admin.attendance;
  usePageMeta(at.title, undefined, { noindex: true });
  const mediumLabel = useMediumLabel();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || schoolToday();
  const { state, retry } = useQuery<OverviewRow[]>((db) => db.rpc('attendance_overview', { p_date: date }), [date]);

  return (
    <>
      <AdminPageHeader
        title={at.title}
        subtitle={at.subtitle}
        actions={
          <label className="flex items-center gap-2 text-sm font-semibold text-navy-800">
            {at.date}
            <input type="date" value={date} max={schoolToday()} onChange={(e) => e.target.value && setParams({ date: e.target.value }, { replace: true })} className={inputClass + ' w-auto'} />
          </label>
        }
      />
      <Panel>
        <QueryView state={state} retry={retry} empty={at.noSections}>
          {(rows) => (
            <div className="-mx-5 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{at.columns.section}</th>
                    <th className="px-3 py-2 text-right font-semibold">{at.columns.onRoll}</th>
                    <th className="px-3 py-2 font-semibold">{at.columns.recorded}</th>
                    <th className="px-3 py-2 text-right font-semibold">{at.columns.present}</th>
                    <th className="px-3 py-2 text-right font-semibold">{at.columns.absent}</th>
                    <th className="px-3 py-2 text-right font-semibold">{at.columns.late}</th>
                    <th className="px-3 py-2 text-right font-semibold">{at.columns.leave}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.section_id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-navy-900">
                          {pick(r.class_name_en, r.class_name_bn)} · {r.section_name}
                        </span>
                        <span className="block text-xs text-slate-500">{mediumLabel(r.medium)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{r.on_roll}</td>
                      <td className="px-3 py-2.5">
                        {r.recorded ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{at.columns.recorded}</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{at.notRecorded}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">{r.recorded ? r.present : '—'}</td>
                      <td className={cx('px-3 py-2.5 text-right', r.absent > 0 && 'font-semibold text-red-700')}>{r.recorded ? r.absent : '—'}</td>
                      <td className="px-3 py-2.5 text-right">{r.recorded ? r.late : '—'}</td>
                      <td className="px-3 py-2.5 text-right">{r.recorded ? r.on_leave : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Link to={`sheet/${r.section_id}?date=${date}`} className={buttonClass('outline', 'px-3 py-1.5 text-xs')}>
                          {at.open}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

export function AdminAttendanceSheetPage() {
  const { sectionId = '' } = useParams();
  const { t } = useLang();
  usePageMeta(t.admin.attendance.sheetTitle, undefined, { noindex: true });
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || schoolToday();
  return (
    <>
      <Link to={`/admin/attendance?date=${date}`} className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <AttendanceSheet sectionId={sectionId} date={date} mode="admin" onDateChange={(d) => setParams({ date: d }, { replace: true })} />
    </>
  );
}

// ====================================================================
interface CorrectionRow {
  id: string;
  session_id: string;
  student_id: string;
  requested_status: AttendanceStatus;
  reason: string;
  requested_by: string | null;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  reviewed_at: string | null;
  record: { status: AttendanceStatus; student: { name_en: string; name_bn: string | null; student_code: string } | null } | null;
  session: { date: string; section: { name: string; class: { name_en: string; name_bn: string | null } | null } | null } | null;
}

const CORRECTION_SELECT =
  'id,session_id,student_id,requested_status,reason,requested_by,requested_at,status,review_note,reviewed_at,' +
  'record:attendance_records(status,student:students(name_en,name_bn,student_code)),' +
  'session:attendance_sessions(date,section:sections(name,class:classes(name_en,name_bn)))';

export function CorrectionsPage() {
  const { t, pick, formatDate } = useLang();
  const c = t.admin.attendance.corrections;
  const at = t.admin.attendance;
  usePageMeta(c.title, undefined, { noindex: true });
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const pending = useQuery<CorrectionRow[]>(
    (db) => db.from('attendance_correction_requests').select(CORRECTION_SELECT).eq('status', 'pending').order('requested_at'),
    [reload],
  );
  const recent = useQuery<CorrectionRow[]>(
    (db) => db.from('attendance_correction_requests').select(CORRECTION_SELECT).neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(15),
    [reload],
  );
  const names = useActorNames(pending.state.status === 'ready' ? pending.state.data.map((r) => r.requested_by).filter((x): x is string => Boolean(x)) : []);

  const review = async (id: string, approve: boolean) => {
    setBusy(id);
    const { error } = await supabase!.rpc('review_attendance_correction', { p_request: id, p_approve: approve, p_note: notes[id]?.trim() || null });
    setBusy(null);
    if (error) return toast('error', attendanceError(t, error));
    toast('success', approve ? c.approved : c.rejected);
    setReload((n) => n + 1);
  };

  const describe = (r: CorrectionRow) => (
    <>
      <p className="font-semibold text-navy-900">
        {r.record?.student ? pick(r.record.student.name_en, r.record.student.name_bn) : '—'}
        <span className="ml-2 font-mono text-xs font-normal text-slate-400">{r.record?.student?.student_code}</span>
      </p>
      <p className="text-xs text-slate-500">
        {r.session?.section?.class ? pick(r.session.section.class.name_en, r.session.section.class.name_bn) : ''} · {r.session?.section?.name} ·{' '}
        {r.session && formatDate(r.session.date + 'T00:00:00')}
      </p>
    </>
  );

  return (
    <>
      <AdminPageHeader title={c.title} subtitle={c.subtitle} />
      <Panel>
        <QueryView state={pending.state} retry={pending.retry} empty={c.empty}>
          {(rows) => (
            <ul className="space-y-4">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      {describe(r)}
                      <p className="mt-2 text-sm">
                        <span className="text-slate-500">{at.currentStatus}:</span> <strong>{r.record ? at.statuses[r.record.status] : '—'}</strong>
                        <span className="mx-2 text-slate-400">→</span>
                        <strong className="text-royal-700">{at.statuses[r.requested_status]}</strong>
                      </p>
                      <p className="mt-1 text-sm text-slate-700">“{r.reason}”</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {c.requestedBy}: {r.requested_by ? names[r.requested_by] ?? '—' : '—'} ·{' '}
                        {formatDate(r.requested_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex w-full flex-col gap-2 md:w-72">
                      <input
                        aria-label={c.reviewNote}
                        placeholder={c.reviewNote}
                        value={notes[r.id] ?? ''}
                        maxLength={500}
                        onChange={(e) => setNotes((x) => ({ ...x, [r.id]: e.target.value }))}
                        className={inputClass}
                      />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy !== null} onClick={() => review(r.id, true)} className={buttonClass('primary', 'flex-1')}>
                          {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                          {c.approve}
                        </button>
                        <button type="button" disabled={busy !== null} onClick={() => review(r.id, false)} className={buttonClass('outline', 'flex-1 text-red-700')}>
                          <X className="h-4 w-4" aria-hidden />
                          {c.reject}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>
      <Panel title={c.recent} className="mt-6">
        <QueryView state={recent.state} retry={recent.retry} empty={t.admin.common.noRecords}>
          {(rows) => (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">{describe(r)}</div>
                  <div className="text-right text-sm">
                    <span
                      className={cx(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700',
                      )}
                    >
                      {c.statuses[r.status]}
                    </span>
                    <span className="ml-2 text-slate-600">→ {at.statuses[r.requested_status]}</span>
                    {r.review_note && <p className="text-xs text-slate-500">{r.review_note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

// ====================================================================
interface AbsenceRow {
  student_id: string;
  student_code: string;
  name_en: string;
  name_bn: string | null;
  class_name_en: string;
  class_name_bn: string | null;
  section_name: string;
  absent: number;
  recorded_days: number;
}

export function AttendanceReportsPage() {
  const { t, pick } = useLang();
  const r = t.admin.attendance.reports;
  usePageMeta(r.title, undefined, { noindex: true });
  const mediumLabel = useMediumLabel();
  const [tab, setTab] = useState<'summary' | 'absence'>('summary');
  const years = useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
  const [yearId, setYearId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const { month, setMonth, from, to } = useMonthRange();
  const sections = useYearSections(yearId);
  const [absFrom, setAbsFrom] = useState(addDays(schoolToday(), -30));
  const [absTo, setAbsTo] = useState(schoolToday());
  const [minAbs, setMinAbs] = useState(3);
  const [absQuery, setAbsQuery] = useState<{ from: string; to: string; min: number } | null>(null);
  const absence = useQuery<AbsenceRow[]>(
    (db) =>
      absQuery
        ? db.rpc('attendance_absence_report', { p_from: absQuery.from, p_to: absQuery.to, p_min_absences: absQuery.min })
        : Promise.resolve({ data: [], error: null }),
    [absQuery],
  );

  useEffect(() => {
    if (!yearId && years.state.status === 'ready' && years.state.data.length) {
      setYearId((years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id);
    }
  }, [years.state, yearId]);

  return (
    <>
      <AdminPageHeader
        title={r.title}
        subtitle={r.subtitle}
        actions={
          <button type="button" onClick={() => window.print()} className={buttonClass('outline', 'no-print')}>
            <Printer className="h-4 w-4" aria-hidden />
            {t.admin.attendance.print}
          </button>
        }
      />
      <div role="tablist" className="no-print mb-6 inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {(['summary', 'absence'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx('rounded-lg px-4 py-2 text-sm font-semibold', tab === k ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}
          >
            {r[k]}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <Panel>
          <div className="no-print mb-5 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-semibold text-navy-800">
              {t.admin.teachers.year}
              <select
                value={yearId}
                onChange={(e) => {
                  setYearId(e.target.value);
                  setSectionId('');
                }}
                className={inputClass + ' mt-1.5'}
              >
                {years.state.status === 'ready' &&
                  years.state.data.map((y) => (
                    <option key={y.id} value={y.id}>
                      {pick(y.name_en, y.name_bn)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-navy-800">
              {t.admin.teachers.section}
              <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={inputClass + ' mt-1.5'}>
                <option value="">{r.selectSection}</option>
                {sections.state.status === 'ready' &&
                  sortSections(sections.state.data).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.class ? pick(s.class.name_en, s.class.name_bn) : ''} · {s.name} ({mediumLabel(s.medium)})
                    </option>
                  ))}
              </select>
            </label>
            <MonthInput label={t.admin.attendance.date} value={month} onChange={setMonth} />
          </div>
          {sectionId ? <SectionSummaryTable sectionId={sectionId} from={from} to={to} /> : null}
        </Panel>
      ) : (
        <Panel>
          <form
            className="no-print mb-5 grid gap-3 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setAbsQuery({ from: absFrom, to: absTo, min: Math.max(1, minAbs) });
            }}
          >
            <label className="text-sm font-semibold text-navy-800">
              {r.from}
              <input type="date" value={absFrom} onChange={(e) => setAbsFrom(e.target.value)} className={inputClass + ' mt-1.5'} />
            </label>
            <label className="text-sm font-semibold text-navy-800">
              {r.to}
              <input type="date" value={absTo} onChange={(e) => setAbsTo(e.target.value)} className={inputClass + ' mt-1.5'} />
            </label>
            <label className="text-sm font-semibold text-navy-800">
              {r.minAbsences}
              <input type="number" min={1} value={minAbs} onChange={(e) => setMinAbs(Number(e.target.value))} className={inputClass + ' mt-1.5'} />
            </label>
            <button type="submit" className={buttonClass('primary')}>
              {r.run}
            </button>
          </form>
          {absQuery && (
            <QueryView state={absence.state} retry={absence.retry} empty={r.empty}>
              {(rows) => (
                <div className="-mx-5 overflow-x-auto sm:mx-0">
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">{t.admin.students.columns.name}</th>
                        <th className="px-3 py-2 font-semibold">{t.admin.students.columns.classSection}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t.admin.attendance.statuses.absent}</th>
                        <th className="px-3 py-2 text-right font-semibold">{r.days}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((a) => (
                        <tr key={a.student_id + a.section_name}>
                          <td className="px-3 py-2">
                            <Link to={`/admin/students/${a.student_id}`} className="font-medium text-navy-900 hover:text-royal-700">
                              {pick(a.name_en, a.name_bn)}
                            </Link>
                            <span className="block font-mono text-xs text-slate-400">{a.student_code}</span>
                          </td>
                          <td className="px-3 py-2">
                            {pick(a.class_name_en, a.class_name_bn)} · {a.section_name}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-red-700">{a.absent}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{a.recorded_days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </QueryView>
          )}
        </Panel>
      )}
    </>
  );
}

// ====================================================================
interface Holiday {
  id: string;
  starts_on: string;
  ends_on: string | null;
  name_en: string;
  name_bn: string | null;
}

export function AttendanceSettingsPage() {
  const { t, pick, formatDate } = useLang();
  const at = t.admin.attendance;
  const s = at.settings;
  usePageMeta(s.title, undefined, { noindex: true });
  const toast = useToast();
  const [offDays, setOffDays] = useState<number[] | null>(null);
  const [editDays, setEditDays] = useState(3);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<{ id?: string; initial: EntityValues } | null>(null);
  const [toDelete, setToDelete] = useState<Holiday | null>(null);

  useEffect(() => {
    supabase
      ?.from('attendance_settings')
      .select('weekly_off_days,teacher_edit_days')
      .single()
      .then(({ data }) => {
        if (!data) return;
        setOffDays(data.weekly_off_days);
        setEditDays(data.teacher_edit_days);
      });
  }, []);
  const holidays = useQuery<Holiday[]>((db) => db.from('holidays').select('*').order('starts_on', { ascending: false }).limit(100), [reload]);

  const fields: EntityField[] = [
    { name: 'starts_on', label: s.startsOn, type: 'date', required: true },
    { name: 'ends_on', label: s.endsOn, type: 'date' },
    { name: 'name_en', label: s.name_en, type: 'text', required: true, maxLength: 120 },
    { name: 'name_bn', label: s.name_bn, type: 'text', maxLength: 120, lang: 'bn' },
  ];

  const saveSettings = async () => {
    if (!offDays) return;
    setSaving(true);
    const { error } = await supabase!
      .from('attendance_settings')
      .update({ weekly_off_days: offDays, teacher_edit_days: Math.min(60, Math.max(0, editDays)) })
      .eq('id', true)
      .select('id')
      .single();
    setSaving(false);
    toast(error ? 'error' : 'success', error ? t.admin.common.saveFailed : t.admin.common.saved);
  };

  return (
    <>
      <AdminPageHeader title={s.title} subtitle={s.subtitle} />
      <Panel>
        {offDays && (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-navy-800">{s.offDays}</legend>
              <div className="flex flex-wrap gap-2">
                {at.weekdays.map((label, i) => {
                  const day = i + 1;
                  const on = offDays.includes(day);
                  return (
                    <label key={day} className={cx('cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium', on ? 'border-gold-400 bg-gold-100 text-navy-900' : 'border-slate-200')}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={(e) => setOffDays((x) => (e.target.checked ? [...(x ?? []), day].sort() : (x ?? []).filter((d) => d !== day)))}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="mt-5 block max-w-md text-sm font-semibold text-navy-800">
              {s.editDays}
              <input type="number" min={0} max={60} value={editDays} onChange={(e) => setEditDays(Number(e.target.value))} className={inputClass + ' mt-1.5 w-32'} />
            </label>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={saveSettings} disabled={saving} className={buttonClass('primary')}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t.admin.common.save}
              </button>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title={s.holidays}
        className="mt-6"
        actions={
          <button type="button" className={buttonClass('primary')} onClick={() => setModal({ initial: { starts_on: '', ends_on: '', name_en: '', name_bn: '' } })}>
            <Plus className="h-4 w-4" aria-hidden />
            {s.addHoliday}
          </button>
        }
      >
        <QueryView state={holidays.state} retry={holidays.retry} empty={t.admin.common.noRecords}>
          {(rows) => (
            <ul className="divide-y divide-slate-100">
              {rows.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="font-medium text-navy-900">{pick(h.name_en, h.name_bn)}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDate(h.starts_on + 'T00:00:00')}
                      {h.ends_on && h.ends_on !== h.starts_on && ` – ${formatDate(h.ends_on + 'T00:00:00')}`}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700"
                      aria-label={`${t.admin.common.edit}: ${h.name_en}`}
                      onClick={() => setModal({ id: h.id, initial: { starts_on: h.starts_on, ends_on: h.ends_on ?? '', name_en: h.name_en, name_bn: h.name_bn ?? '' } })}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                      aria-label={`${t.admin.common.delete}: ${h.name_en}`}
                      onClick={() => setToDelete(h)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>

      <EntityModal
        open={modal !== null}
        title={s.addHoliday}
        fields={fields}
        initial={modal?.initial ?? {}}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          if (v.ends_on && String(v.ends_on) < String(v.starts_on)) return t.admin.common.endBeforeStart;
          const payload = toEntityPayload(fields, v);
          const { error } = modal?.id
            ? await supabase!.from('holidays').update(payload).eq('id', modal.id)
            : await supabase!.from('holidays').insert(payload);
          if (error) return attendanceError(t, error);
          setModal(null);
          toast('success', t.admin.common.saved);
          setReload((n) => n + 1);
          return null;
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={t.admin.common.confirmDeleteTitle}
        body={`"${toDelete?.name_en ?? ''}"`}
        confirmLabel={t.admin.common.delete}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const { error } = await supabase!.from('holidays').delete().eq('id', toDelete!.id);
          setToDelete(null);
          if (error) toast('error', t.admin.common.deleteFailed);
          else {
            toast('success', t.admin.common.deleted);
            setReload((n) => n + 1);
          }
        }}
      />
    </>
  );
}
