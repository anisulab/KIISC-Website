import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarOff, CheckCheck, ChevronLeft, ChevronRight, Clock, Loader2, Lock, Printer } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import {
  ATTENDANCE_STATUSES,
  STATUS_TONES,
  addDays,
  isoWeekday,
  schoolToday,
  type AttendanceStatus,
  type RosterRow,
  type SectionInfo,
} from '@/lib/attendance';
import { QueryView, Spinner, buttonClass, cx, inputClass } from '@/components/ui';
import { InlineNotice, Modal, Panel, SelectField, TextAreaField, useToast } from '@/components/admin/adminUi';
import { useMediumLabel } from '@/components/admissions';

type Entry = { status: AttendanceStatus; note: string };

export function attendanceError(t: { admin: { attendance: { errors: Record<string, string> } } }, error: { message: string; code?: string } | null) {
  const e = t.admin.attendance.errors;
  if (!error) return e.generic;
  return e[error.message] ?? (error.code ? e[error.code] : undefined) ?? e.generic;
}

export default function AttendanceSheet({
  sectionId,
  date,
  onDateChange,
  mode,
}: {
  sectionId: string;
  date: string;
  onDateChange: (date: string) => void;
  mode: 'admin' | 'teacher';
}) {
  const { t, pick, formatDate } = useLang();
  const at = t.admin.attendance;
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const today = schoolToday();
  const [reload, setReload] = useState(0);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [saving, setSaving] = useState(false);
  const [correction, setCorrection] = useState<{ student: RosterRow; current: AttendanceStatus } | null>(null);

  const section = useQuery<SectionInfo | null>(
    (db) => db.from('sections').select('id,name,medium,academic_year_id,class:classes(name_en,name_bn,level)').eq('id', sectionId).maybeSingle(),
    [sectionId],
  );
  const roster = useQuery<RosterRow[]>((db) => db.rpc('get_section_roster', { p_section: sectionId, p_date: date }), [sectionId, date]);
  const session = useQuery<{ id: string; updated_at: string } | null>(
    (db) => db.from('attendance_sessions').select('id,updated_at').eq('section_id', sectionId).eq('date', date).maybeSingle(),
    [sectionId, date, reload],
  );
  const sessionId = session.state.status === 'ready' ? session.state.data?.id ?? null : null;
  const records = useQuery<{ student_id: string; status: AttendanceStatus; note: string | null }[]>(
    (db) =>
      sessionId
        ? db.from('attendance_records').select('student_id,status,note').eq('session_id', sessionId)
        : Promise.resolve({ data: [], error: null }),
    [sessionId, reload],
  );
  const pending = useQuery<{ student_id: string }[]>(
    (db) =>
      sessionId
        ? db.from('attendance_correction_requests').select('student_id').eq('session_id', sessionId).eq('status', 'pending')
        : Promise.resolve({ data: [], error: null }),
    [sessionId, reload],
  );
  const settings = useQuery<{ weekly_off_days: number[]; teacher_edit_days: number } | null>(
    (db) => db.from('attendance_settings').select('weekly_off_days,teacher_edit_days').maybeSingle(),
    [],
  );
  const holiday = useQuery<{ name_en: string; name_bn: string | null }[]>(
    (db) =>
      db
        .from('holidays')
        .select('name_en,name_bn')
        .lte('starts_on', date)
        .or(`ends_on.gte.${date},and(ends_on.is.null,starts_on.eq.${date})`)
        .limit(1),
    [date],
  );
  const classTeacher = useQuery<{ id: string }[]>(
    (db) =>
      mode === 'teacher'
        ? db.from('teacher_assignments').select('id').eq('section_id', sectionId).eq('role', 'class_teacher')
        : Promise.resolve({ data: [], error: null }),
    [sectionId, mode],
  );

  // Initialise the editable state from saved records (or "present" for a new sheet).
  useEffect(() => {
    if (roster.state.status !== 'ready' || records.state.status !== 'ready') return;
    const saved = new Map(records.state.data.map((r) => [r.student_id, r]));
    setEntries(
      Object.fromEntries(
        roster.state.data.map((s) => {
          const r = saved.get(s.student_id);
          return [s.student_id, { status: r?.status ?? 'present', note: r?.note ?? '' }];
        }),
      ),
    );
  }, [roster.state, records.state]);

  const cfg = settings.state.status === 'ready' ? settings.state.data : null;
  const holidayRow = holiday.state.status === 'ready' ? holiday.state.data[0] : undefined;
  const offDay = Boolean(cfg?.weekly_off_days.includes(isoWeekday(date)));
  const working = !offDay && !holidayRow;
  const future = date > today;
  const isClassTeacher = mode === 'admin' || (classTeacher.state.status === 'ready' && classTeacher.state.data.length > 0);
  const withinWindow = mode === 'admin' || (cfg ? date >= addDays(today, -cfg.teacher_edit_days) : false);
  const canEdit = working && !future && isClassTeacher && withinWindow;
  const canRequestCorrection = mode === 'teacher' && Boolean(sessionId) && !canEdit && !future;
  const pendingSet = useMemo(
    () => new Set(pending.state.status === 'ready' ? pending.state.data.map((p) => p.student_id) : []),
    [pending.state],
  );
  const savedStatus = useMemo(
    () => new Map(records.state.status === 'ready' ? records.state.data.map((r) => [r.student_id, r.status]) : []),
    [records.state],
  );

  const counts = ATTENDANCE_STATUSES.map((s) => [s, Object.values(entries).filter((e) => e.status === s).length] as const);

  const save = async () => {
    if (!supabase || roster.state.status !== 'ready') return;
    setSaving(true);
    const { error } = await supabase.rpc('save_attendance', {
      p_section: sectionId,
      p_date: date,
      p_records: roster.state.data.map((s) => ({
        student_id: s.student_id,
        status: entries[s.student_id]?.status ?? 'present',
        note: entries[s.student_id]?.note || null,
      })),
    });
    setSaving(false);
    if (error) return toast('error', attendanceError(t, error));
    toast('success', at.saved);
    setReload((n) => n + 1);
  };

  const sectionData = section.state.status === 'ready' ? section.state.data : null;
  const lastSaved = session.state.status === 'ready' && session.state.data ? session.state.data.updated_at : null;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="heading text-xl font-bold text-navy-900">
              {sectionData?.class ? pick(sectionData.class.name_en, sectionData.class.name_bn) : '…'}
              {sectionData && ` · ${sectionData.name}`}
            </h2>
            <p className="text-sm text-slate-500">
              {sectionData && mediumLabel(sectionData.medium)} · {formatDate(date + 'T00:00:00', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            {lastSaved && (
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {at.lastSaved(formatDate(lastSaved, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
              </p>
            )}
          </div>
          <div className="no-print flex items-center gap-2">
            <button type="button" onClick={() => onDateChange(addDays(date, -1))} className={buttonClass('outline', 'px-2.5')} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <label className="sr-only" htmlFor="sheet-date">
              {at.date}
            </label>
            <input id="sheet-date" type="date" value={date} max={today} onChange={(e) => e.target.value && onDateChange(e.target.value)} className={inputClass + ' w-auto'} />
            <button
              type="button"
              onClick={() => onDateChange(addDays(date, 1))}
              disabled={date >= today}
              className={buttonClass('outline', 'px-2.5')}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => window.print()} className={buttonClass('outline', 'px-2.5')} aria-label={at.print}>
              <Printer className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </Panel>

      {!working && (
        <InlineNotice tone="warning">
          <span className="inline-flex items-center gap-2">
            <CalendarOff className="h-4 w-4" aria-hidden />
            {holidayRow ? `${pick(holidayRow.name_en, holidayRow.name_bn)}. ` : ''}
            {at.notWorkingDay}
          </span>
        </InlineNotice>
      )}
      {future && <InlineNotice tone="warning">{at.future}</InlineNotice>}
      {working && !future && mode === 'teacher' && classTeacher.state.status === 'ready' && !isClassTeacher && <InlineNotice>{at.readOnly}</InlineNotice>}
      {working && !future && isClassTeacher && !withinWindow && (
        <InlineNotice tone="warning">
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4" aria-hidden />
            {at.locked}
          </span>
        </InlineNotice>
      )}
      {!canEdit && session.state.status === 'ready' && !session.state.data && working && !future && <InlineNotice>{at.notRecordedYet}</InlineNotice>}

      <Panel>
        <QueryView state={roster.state} retry={roster.retry} empty={at.noRoster}>
          {(rows) =>
            records.state.status !== 'ready' || Object.keys(entries).length === 0 ? (
              <Spinner />
            ) : (
              <>
                {canEdit && (
                  <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setEntries((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v, status: 'present' as const }])))}
                      className={buttonClass('outline', 'px-3 py-1.5 text-xs')}
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden />
                      {at.markAllPresent}
                    </button>
                    <p className="flex flex-wrap gap-3 text-sm">
                      {counts.map(([s, n]) => (
                        <span key={s} className="text-slate-600">
                          {at.statuses[s]}: <strong className="text-navy-900">{n}</strong>
                        </span>
                      ))}
                    </p>
                  </div>
                )}
                <div className="-mx-5 overflow-x-auto sm:mx-0">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="w-14 px-3 py-2 font-semibold">#</th>
                        <th className="px-3 py-2 font-semibold">{t.admin.students.columns.name}</th>
                        <th className="px-3 py-2 font-semibold">{t.admin.students.columns.status}</th>
                        <th className="px-3 py-2 font-semibold">{at.note}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((s) => {
                        const entry = entries[s.student_id];
                        if (!entry) return null;
                        const label = pick(s.name_en, s.name_bn);
                        const saved = savedStatus.get(s.student_id);
                        return (
                          <tr key={s.student_id}>
                            <td className="px-3 py-2 text-slate-500">{s.roll_no ?? '—'}</td>
                            <td className="px-3 py-2">
                              <span className="font-medium text-navy-900">{label}</span>
                              <span className="block font-mono text-xs text-slate-400">{s.student_code}</span>
                            </td>
                            <td className="px-3 py-2">
                              {canEdit ? (
                                <div role="radiogroup" aria-label={label} className="inline-flex gap-1">
                                  {ATTENDANCE_STATUSES.map((st) => (
                                    <button
                                      key={st}
                                      type="button"
                                      role="radio"
                                      aria-checked={entry.status === st}
                                      title={at.statuses[st]}
                                      onClick={() => setEntries((x) => ({ ...x, [s.student_id]: { ...x[s.student_id], status: st } }))}
                                      className={cx(
                                        'min-w-[2.5rem] rounded-lg border px-2 py-1.5 text-xs font-bold transition',
                                        entry.status === st ? STATUS_TONES[st].on : cx('bg-white', STATUS_TONES[st].off),
                                      )}
                                    >
                                      {at.short[st]}
                                    </button>
                                  ))}
                                </div>
                              ) : saved ? (
                                <span className="inline-flex items-center gap-2">
                                  <span className={cx('rounded-full border px-2.5 py-0.5 text-xs font-semibold', STATUS_TONES[saved].on)}>{at.statuses[saved]}</span>
                                  {pendingSet.has(s.student_id) ? (
                                    <span className="text-xs text-gold-600">{at.pending}</span>
                                  ) : (
                                    canRequestCorrection && (
                                      <button
                                        type="button"
                                        onClick={() => setCorrection({ student: s, current: saved })}
                                        className="no-print text-xs font-semibold text-royal-700 hover:underline"
                                      >
                                        {at.requestCorrection}
                                      </button>
                                    )
                                  )}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {canEdit ? (
                                <input
                                  aria-label={`${at.note}: ${label}`}
                                  value={entry.note}
                                  maxLength={200}
                                  onChange={(e) => setEntries((x) => ({ ...x, [s.student_id]: { ...x[s.student_id], note: e.target.value } }))}
                                  className={inputClass + ' py-1.5'}
                                />
                              ) : (
                                <span className="text-slate-600">{records.state.status === 'ready' ? records.state.data.find((r) => r.student_id === s.student_id)?.note ?? '' : ''}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {canEdit && (
                  <div className="no-print mt-5 flex justify-end">
                    <button type="button" onClick={save} disabled={saving} className={buttonClass('primary', 'px-6')}>
                      {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {at.save}
                    </button>
                  </div>
                )}
              </>
            )
          }
        </QueryView>
      </Panel>

      <CorrectionModal
        target={correction}
        sessionId={sessionId}
        onClose={() => setCorrection(null)}
        onDone={() => {
          setCorrection(null);
          toast('success', at.correctionSent);
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}

function CorrectionModal({
  target,
  sessionId,
  onClose,
  onDone,
}: {
  target: { student: RosterRow; current: AttendanceStatus } | null;
  sessionId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, pick } = useLang();
  const at = t.admin.attendance;
  const [status, setStatus] = useState<AttendanceStatus | ''>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus('');
    setReason('');
    setError(null);
  }, [target]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || !sessionId || !status) return setError(t.admin.common.required);
    if (reason.trim().length < 3) return setError(at.errors.REASON_REQUIRED);
    setBusy(true);
    const { error: err } = await supabase!.rpc('request_attendance_correction', {
      p_session: sessionId,
      p_student: target.student.student_id,
      p_status: status,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (err) return setError(attendanceError(t, err));
    onDone();
  };

  return (
    <Modal open={target !== null} title={at.correctionTitle} onClose={onClose}>
      {target && (
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="text-sm text-slate-700">
            <strong>{pick(target.student.name_en, target.student.name_bn)}</strong> · {at.currentStatus}: {at.statuses[target.current]}
          </p>
          <SelectField
            label={at.newStatus}
            required
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatus | '')}
            options={[{ value: '', label: t.apply.select }, ...ATTENDANCE_STATUSES.filter((s) => s !== target.current).map((s) => ({ value: s, label: at.statuses[s] }))]}
          />
          <TextAreaField label={at.reason} required rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={buttonClass('outline')}>
              {t.admin.common.cancel}
            </button>
            <button type="submit" disabled={busy} className={buttonClass('primary')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {at.requestCorrection}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
