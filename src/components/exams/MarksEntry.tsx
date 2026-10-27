import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { schoolToday, type RosterRow } from '@/lib/attendance';
import { MARK_STATUSES, examError, validMarks, type ExamStatus, type MarkStatus } from '@/lib/exams';
import { QueryView, Spinner, buttonClass, cx, inputClass } from '@/components/ui';
import { InlineNotice, Modal, Panel, SelectField, TextAreaField, TextField, useToast } from '@/components/admin/adminUi';

interface EsInfo {
  id: string;
  full_marks: number;
  pass_marks: number;
  subject: { name_en: string; name_bn: string | null } | null;
  exam: { id: string; name_en: string; name_bn: string | null; status: ExamStatus; ends_on: string | null } | null;
}
interface MarkRow {
  id: string;
  student_id: string;
  marks: number | null;
  mark_status: MarkStatus;
}
type Entry = { marks: string; status: MarkStatus };

export default function MarksEntry({ examSubjectId, sectionId, mode }: { examSubjectId: string; sectionId: string; mode: 'admin' | 'teacher' | 'view' }) {
  const { t, pick } = useLang();
  const mk = t.admin.exams.marks;
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [correction, setCorrection] = useState<{ mark: MarkRow; name: string } | null>(null);

  const es = useQuery<EsInfo | null>(
    (db) =>
      db
        .from('examination_subjects')
        .select('id,full_marks,pass_marks,subject:subjects(name_en,name_bn),exam:examinations(id,name_en,name_bn,status,ends_on)')
        .eq('id', examSubjectId)
        .maybeSingle(),
    [examSubjectId],
  );
  const info = es.state.status === 'ready' ? es.state.data : null;
  const rosterDate = info?.exam?.ends_on && info.exam.ends_on < schoolToday() ? info.exam.ends_on : schoolToday();
  const roster = useQuery<RosterRow[]>(
    (db) => (info ? db.rpc('get_section_roster', { p_section: sectionId, p_date: rosterDate }) : Promise.resolve({ data: [], error: null })),
    [sectionId, rosterDate, Boolean(info)],
  );
  const marks = useQuery<MarkRow[]>(
    (db) => db.from('student_marks').select('id,student_id,marks,mark_status').eq('examination_subject_id', examSubjectId).eq('section_id', sectionId),
    [examSubjectId, sectionId, reload],
  );
  const pending = useQuery<{ mark_id: string }[]>(
    (db) => db.from('marks_correction_requests').select('mark_id').eq('status', 'pending'),
    [reload],
  );

  useEffect(() => {
    if (roster.state.status !== 'ready' || marks.state.status !== 'ready') return;
    const saved = new Map(marks.state.data.map((m) => [m.student_id, m]));
    setEntries(
      Object.fromEntries(
        roster.state.data.map((s) => {
          const m = saved.get(s.student_id);
          return [s.student_id, { marks: m?.marks == null ? '' : String(Number(m.marks)), status: m?.mark_status ?? 'present' }];
        }),
      ),
    );
    setErrors({});
  }, [roster.state, marks.state]);

  const status = info?.exam?.status;
  const canEdit = mode !== 'view' && (status === 'marks_entry' || (mode === 'admin' && (status === 'draft' || status === 'under_review')));
  const canCorrect = mode !== 'view' && !canEdit && (status === 'under_review' || status === 'approved' || status === 'published');
  const savedByStudent = useMemo(
    () => new Map(marks.state.status === 'ready' ? marks.state.data.map((m) => [m.student_id, m]) : []),
    [marks.state],
  );
  const pendingSet = new Set(pending.state.status === 'ready' ? pending.state.data.map((p) => p.mark_id) : []);

  const save = async () => {
    if (!info || roster.state.status !== 'ready') return;
    const errs: Record<string, boolean> = {};
    for (const s of roster.state.data) {
      const e = entries[s.student_id];
      if (e?.status === 'present' && e.marks.trim() !== '' && !validMarks(e.marks, Number(info.full_marks))) errs[s.student_id] = true;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return toast('error', mk.invalid);
    setSaving(true);
    const { data, error } = await supabase!.rpc('save_marks', {
      p_exam_subject: examSubjectId,
      p_section: sectionId,
      p_entries: roster.state.data.map((s) => {
        const e = entries[s.student_id];
        return {
          student_id: s.student_id,
          mark_status: e.status,
          marks: e.status === 'present' && e.marks.trim() !== '' ? Number(e.marks) : null,
        };
      }),
    });
    setSaving(false);
    if (error) return toast('error', examError(t, error));
    toast('success', mk.saved(Number(data)));
    setReload((n) => n + 1);
  };

  if (es.state.status === 'loading') return <Spinner />;
  if (!info) return <InlineNotice tone="warning">{t.admin.common.noRecords}</InlineNotice>;
  const full = Number(info.full_marks);

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="heading text-lg font-bold text-navy-900">{info.subject ? pick(info.subject.name_en, info.subject.name_bn) : ''}</h2>
        <p className="text-sm text-slate-600">
          {mk.outOf(full)} · {mk.pass(Number(info.pass_marks))}
        </p>
      </div>
      {!canEdit && mode !== 'view' && (
        <div className="mb-4">
          <InlineNotice tone="warning">
            <span className="inline-flex items-center gap-2">
              <Lock className="h-4 w-4" aria-hidden />
              {canCorrect ? mk.locked : mk.notOpen}
            </span>
          </InlineNotice>
        </div>
      )}
      <QueryView state={roster.state} retry={roster.retry} empty={t.admin.attendance.noRoster}>
        {(rows) =>
          marks.state.status !== 'ready' || Object.keys(entries).length === 0 ? (
            <Spinner />
          ) : (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-14 px-3 py-2 font-semibold">#</th>
                      <th className="px-3 py-2 font-semibold">{t.admin.students.columns.name}</th>
                      <th className="w-40 px-3 py-2 font-semibold">{mk.status}</th>
                      <th className="w-36 px-3 py-2 font-semibold">{mk.marks}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((s) => {
                      const e = entries[s.student_id];
                      if (!e) return null;
                      const name = pick(s.name_en, s.name_bn);
                      const saved = savedByStudent.get(s.student_id);
                      const failing = e.status === 'present' && e.marks !== '' && Number(e.marks) < Number(info.pass_marks);
                      return (
                        <tr key={s.student_id}>
                          <td className="px-3 py-2 text-slate-500">{s.roll_no ?? '—'}</td>
                          <td className="px-3 py-2">
                            <span className="font-medium text-navy-900">{name}</span>
                            <span className="block font-mono text-xs text-slate-400">{s.student_code}</span>
                          </td>
                          <td className="px-3 py-2">
                            {canEdit ? (
                              <select
                                aria-label={`${mk.status}: ${name}`}
                                value={e.status}
                                onChange={(ev) =>
                                  setEntries((x) => ({ ...x, [s.student_id]: { status: ev.target.value as MarkStatus, marks: ev.target.value === 'present' ? x[s.student_id].marks : '' } }))
                                }
                                className={inputClass + ' py-1.5'}
                              >
                                {MARK_STATUSES.map((ms) => (
                                  <option key={ms} value={ms}>
                                    {mk.markStatuses[ms]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-slate-700">{mk.markStatuses[e.status]}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {canEdit ? (
                              <input
                                aria-label={`${mk.marks}: ${name}`}
                                aria-invalid={errors[s.student_id] || undefined}
                                inputMode="decimal"
                                disabled={e.status !== 'present'}
                                value={e.marks}
                                onChange={(ev) => {
                                  setEntries((x) => ({ ...x, [s.student_id]: { ...x[s.student_id], marks: ev.target.value } }));
                                  setErrors((x) => ({ ...x, [s.student_id]: false }));
                                }}
                                className={cx(inputClass, 'py-1.5 text-right', errors[s.student_id] && 'border-red-400', failing && 'text-red-700', e.status !== 'present' && 'bg-slate-50')}
                              />
                            ) : (
                              <span className={cx('font-semibold', failing ? 'text-red-700' : 'text-navy-900')}>{e.marks || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canCorrect && saved && (
                              pendingSet.has(saved.id) ? (
                                <span className="text-xs text-gold-600">{mk.pending}</span>
                              ) : (
                                <button type="button" onClick={() => setCorrection({ mark: saved, name })} className="text-xs font-semibold text-royal-700 hover:underline">
                                  {mk.requestCorrection}
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canEdit && (
                <div className="mt-5 flex justify-end">
                  <button type="button" onClick={save} disabled={saving} className={buttonClass('primary', 'px-6')}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {mk.save}
                  </button>
                </div>
              )}
            </>
          )
        }
      </QueryView>
      <MarksCorrectionModal
        target={correction}
        full={full}
        onClose={() => setCorrection(null)}
        onDone={() => {
          setCorrection(null);
          toast('success', mk.correctionSent);
          setReload((n) => n + 1);
        }}
      />
    </Panel>
  );
}

function MarksCorrectionModal({
  target,
  full,
  onClose,
  onDone,
}: {
  target: { mark: MarkRow; name: string } | null;
  full: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLang();
  const mk = t.admin.exams.marks;
  const [status, setStatus] = useState<MarkStatus>('present');
  const [marks, setMarks] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(target?.mark.mark_status ?? 'present');
    setMarks(target?.mark.marks == null ? '' : String(Number(target.mark.marks)));
    setReason('');
    setError(null);
  }, [target]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    if (status === 'present' && !validMarks(marks, full)) return setError(mk.invalid);
    if (reason.trim().length < 3) return setError(t.admin.exams.errors.REASON_REQUIRED);
    setBusy(true);
    const { error: err } = await supabase!.rpc('request_marks_correction', {
      p_mark: target.mark.id,
      p_marks: status === 'present' ? Number(marks) : null,
      p_status: status,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (err) return setError(examError(t, err));
    onDone();
  };

  return (
    <Modal open={target !== null} title={mk.correctionTitle} onClose={onClose}>
      {target && (
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="text-sm font-semibold text-navy-900">{target.name}</p>
          <SelectField
            label={mk.status}
            value={status}
            onChange={(e) => setStatus(e.target.value as MarkStatus)}
            options={MARK_STATUSES.map((s) => ({ value: s, label: mk.markStatuses[s] }))}
          />
          {status === 'present' && <TextField label={mk.newMarks} inputMode="decimal" value={marks} onChange={(e) => setMarks(e.target.value)} hint={mk.outOf(full)} />}
          <TextAreaField label={mk.reason} required rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
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
              {mk.requestCorrection}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
