import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { QueryView, buttonClass, cx } from '@/components/ui';
import { Modal, SelectField, TextField, useToast } from '@/components/admin/adminUi';
import type { Dict } from '@/i18n/en';

export interface Period {
  id: string;
  period_no: number;
  name_en: string | null;
  name_bn: string | null;
  starts_at: string;
  ends_at: string;
  is_break: boolean;
}

export interface TimetableEntry {
  id: string;
  section_id: string;
  weekday: number;
  period_no: number;
  subject_id: string;
  teacher_id: string | null;
  room: string | null;
  subject: { name_en: string; name_bn: string | null } | null;
  teacher: { name_en: string; name_bn: string | null } | null;
  section?: { name: string; class: { name_en: string; name_bn: string | null } | null } | null;
}

export const ENTRY_SELECT =
  'id,section_id,weekday,period_no,subject_id,teacher_id,room,subject:subjects(name_en,name_bn),teacher:teachers(name_en,name_bn),section:sections(name,class:classes(name_en,name_bn))';

/** School week starting Saturday, without the weekly off-days. */
export function useSchoolDays() {
  const settings = useQuery<{ weekly_off_days: number[] } | null>((db) => db.from('attendance_settings').select('weekly_off_days').maybeSingle(), []);
  const off = settings.state.status === 'ready' ? settings.state.data?.weekly_off_days ?? [5] : [5];
  return [6, 7, 1, 2, 3, 4, 5].filter((d) => !off.includes(d));
}

export function usePeriods(yearId: string | null | undefined, reload = 0) {
  return useQuery<Period[]>(
    (db) => (yearId ? db.from('timetable_periods').select('*').eq('academic_year_id', yearId).order('period_no') : Promise.resolve({ data: [], error: null })),
    [yearId, reload],
  );
}

export function timetableError(t: Dict, error: { message: string; code?: string } | null) {
  const e = t.admin.timetable.errors;
  if (!error) return e.generic;
  return e[error.message] ?? (error.code ? e[error.code] : undefined) ?? e.generic;
}

const hhmm = (time: string) => time.slice(0, 5);

/** Days × periods grid; `cell` renders the contents of each teaching slot. */
export function TimetableGrid({
  periods,
  days,
  cell,
  onCellClick,
}: {
  periods: Period[];
  days: number[];
  cell: (weekday: number, periodNo: number) => ReactNode;
  onCellClick?: (weekday: number, periodNo: number) => void;
}) {
  const { t, pick } = useLang();
  const weekdayNames = t.admin.attendance.weekdays;
  return (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-20 border border-slate-200 bg-slate-50 px-2 py-2" />
            {periods.map((p) => (
              <th key={p.id} className={cx('border border-slate-200 px-2 py-2 text-xs font-semibold', p.is_break ? 'bg-gold-100 text-gold-600' : 'bg-slate-50 text-slate-600')}>
                {pick(p.name_en, p.name_bn) || p.period_no}
                <span className="block font-normal text-slate-400">
                  {hhmm(p.starts_at)}–{hhmm(p.ends_at)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-left text-xs font-semibold text-navy-800">{weekdayNames[d - 1]}</th>
              {periods.map((p) =>
                p.is_break ? (
                  <td key={p.id} className="border border-slate-200 bg-gold-100/40 text-center text-xs text-gold-600">
                    {t.admin.timetable.breakLabel}
                  </td>
                ) : (
                  <td key={p.id} className="h-16 border border-slate-200 p-0 align-top">
                    {onCellClick ? (
                      <button type="button" onClick={() => onCellClick(d, p.period_no)} className="block h-full min-h-16 w-full p-1.5 text-left hover:bg-royal-50">
                        {cell(d, p.period_no)}
                      </button>
                    ) : (
                      <div className="p-1.5">{cell(d, p.period_no)}</div>
                    )}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LessonCell({ entry, showSection = false, showTeacher = true }: { entry?: TimetableEntry; showSection?: boolean; showTeacher?: boolean }) {
  const { pick } = useLang();
  if (!entry) return <span className="text-slate-300">—</span>;
  return (
    <span className="block leading-tight">
      <span className="block text-xs font-semibold text-navy-900">{entry.subject ? pick(entry.subject.name_en, entry.subject.name_bn) : ''}</span>
      {showSection && entry.section && (
        <span className="block text-[11px] text-royal-700">
          {entry.section.class ? pick(entry.section.class.name_en, entry.section.class.name_bn) : ''} · {entry.section.name}
        </span>
      )}
      {showTeacher && entry.teacher && <span className="block text-[11px] text-slate-500">{pick(entry.teacher.name_en, entry.teacher.name_bn)}</span>}
      {entry.room && <span className="block text-[11px] text-slate-400">{entry.room}</span>}
    </span>
  );
}

/** Read-only timetable for one section (portals). */
export function SectionTimetable({ sectionId, yearId }: { sectionId: string; yearId: string }) {
  const { t } = useLang();
  const days = useSchoolDays();
  const periods = usePeriods(yearId);
  const entries = useQuery<TimetableEntry[]>((db) => db.from('timetable_entries').select(ENTRY_SELECT).eq('section_id', sectionId), [sectionId]);
  const map = new Map((entries.state.status === 'ready' ? entries.state.data : []).map((e) => [`${e.weekday}:${e.period_no}`, e]));
  return (
    <QueryView state={periods.state} retry={periods.retry} empty={t.family.noTimetable} isEmpty={(p) => p.length === 0 || map.size === 0 && entries.state.status === 'ready'}>
      {(p) => <TimetableGrid periods={p} days={days} cell={(d, n) => <LessonCell entry={map.get(`${d}:${n}`)} />} />}
    </QueryView>
  );
}

/** Editable timetable for admins: click a slot to set subject, teacher and room. */
export function EditableTimetable({ sectionId, yearId, classId, medium }: { sectionId: string; yearId: string; classId: string; medium: string }) {
  const { t, pick } = useLang();
  const tt = t.admin.timetable;
  const toast = useToast();
  const days = useSchoolDays();
  const [reload, setReload] = useState(0);
  const [slot, setSlot] = useState<{ weekday: number; period: number } | null>(null);
  const periods = usePeriods(yearId);
  const entries = useQuery<TimetableEntry[]>((db) => db.from('timetable_entries').select(ENTRY_SELECT).eq('section_id', sectionId), [sectionId, reload]);
  const subjects = useQuery<{ subject: { id: string; name_en: string; name_bn: string | null } | null }[]>(
    (db) => db.from('class_subjects').select('subject:subjects(id,name_en,name_bn)').eq('class_id', classId).eq('medium', medium).order('sort_order'),
    [classId, medium],
  );
  const teachers = useQuery<{ id: string; name_en: string; name_bn: string | null }[]>(
    (db) => db.from('teachers').select('id,name_en,name_bn').eq('is_active', true).order('name_en'),
    [],
  );
  const map = new Map((entries.state.status === 'ready' ? entries.state.data : []).map((e) => [`${e.weekday}:${e.period_no}`, e]));
  const current = slot ? map.get(`${slot.weekday}:${slot.period}`) : undefined;

  return (
    <>
      <p className="mb-3 text-xs text-slate-500">{tt.cellHelp}</p>
      <QueryView state={periods.state} retry={periods.retry} empty={tt.noPeriods}>
        {(p) => (
          <TimetableGrid
            periods={p}
            days={days}
            cell={(d, n) => <LessonCell entry={map.get(`${d}:${n}`)} />}
            onCellClick={(d, n) => setSlot({ weekday: d, period: n })}
          />
        )}
      </QueryView>
      <CellModal
        open={slot !== null}
        current={current}
        subjects={subjects.state.status === 'ready' ? subjects.state.data.filter((s) => s.subject).map((s) => ({ value: s.subject!.id, label: pick(s.subject!.name_en, s.subject!.name_bn) })) : []}
        teachers={teachers.state.status === 'ready' ? teachers.state.data.map((x) => ({ value: x.id, label: pick(x.name_en, x.name_bn) })) : []}
        onClose={() => setSlot(null)}
        onSave={async (subjectId, teacherId, room) => {
          if (!slot) return null;
          const payload = { section_id: sectionId, weekday: slot.weekday, period_no: slot.period, subject_id: subjectId, teacher_id: teacherId || null, room: room || null };
          const { error } = current
            ? await supabase!.from('timetable_entries').update(payload).eq('id', current.id)
            : await supabase!.from('timetable_entries').insert(payload);
          if (error) return timetableError(t, error);
          setSlot(null);
          setReload((n) => n + 1);
          return null;
        }}
        onClear={async () => {
          if (!current) return;
          const { error } = await supabase!.from('timetable_entries').delete().eq('id', current.id);
          if (error) toast('error', timetableError(t, error));
          setSlot(null);
          setReload((n) => n + 1);
        }}
      />
    </>
  );
}

function CellModal({
  open,
  current,
  subjects,
  teachers,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  current?: TimetableEntry;
  subjects: { value: string; label: string }[];
  teachers: { value: string; label: string }[];
  onClose: () => void;
  onSave: (subjectId: string, teacherId: string, room: string) => Promise<string | null>;
  onClear: () => void;
}) {
  const { t } = useLang();
  const tt = t.admin.timetable;
  const [subject, setSubject] = useState('');
  const [teacher, setTeacher] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSubject(current?.subject_id ?? '');
    setTeacher(current?.teacher_id ?? '');
    setRoom(current?.room ?? '');
    setError(null);
  }, [open, current]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!subject) return setError(t.admin.common.required);
    setBusy(true);
    const err = await onSave(subject, teacher, room.trim());
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Modal open={open} title={tt.editCell} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField label={tt.fields.subject} required value={subject} onChange={(e) => setSubject(e.target.value)} options={[{ value: '', label: t.apply.select }, ...subjects]} />
        <SelectField label={tt.fields.teacher} value={teacher} onChange={(e) => setTeacher(e.target.value)} options={[{ value: '', label: tt.noTeacher }, ...teachers]} />
        <TextField label={tt.fields.room} maxLength={30} value={room} onChange={(e) => setRoom(e.target.value)} />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-between gap-3">
          {current ? (
            <button type="button" onClick={onClear} className={buttonClass('ghost', 'text-red-700 hover:bg-red-50')}>
              {tt.clearCell}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={buttonClass('outline')}>
              {t.admin.common.cancel}
            </button>
            <button type="submit" disabled={busy} className={buttonClass('primary')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t.admin.common.save}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
