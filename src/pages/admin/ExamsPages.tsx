import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { EXAM_MANAGE_ROLES, RESULT_APPROVE_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { MEDIUMS, type AcademicTerm, type AcademicYear, type ClassWithStreams, type Medium } from '@/lib/academics';
import { EXAM_ACTIONS, EXAM_STATUS_TONES, examError, formatNumber, type Exam, type ExamStatus, type ExamSubject, type MarkStatus } from '@/lib/exams';
import { QueryView, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, InlineNotice, Modal, Panel, TextAreaField, useToast } from '@/components/admin/adminUi';
import { EntityModal, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { useMediumLabel } from '@/components/admissions';
import MarksEntry from '@/components/exams/MarksEntry';
import { ReportCard, ResultsTable } from '@/components/exams/Results';
import { sortSections, useYearSections } from './AttendanceAdminPages';
import { useActorNames } from './AuditPage';

export function ExamStatusBadge({ status }: { status: ExamStatus }) {
  const { t } = useLang();
  return <span className={cx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', EXAM_STATUS_TONES[status])}>{t.admin.exams.statuses[status]}</span>;
}

function useYears() {
  return useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
}

// ====================================================================
type ExamRow = Exam & { year: { name_en: string; name_bn: string | null } | null };

export function ExamsListPage() {
  const { t, pick, formatDate } = useLang();
  const ex = t.admin.exams;
  usePageMeta(ex.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, EXAM_MANAGE_ROLES);
  const toast = useToast();
  const years = useYears();
  const [yearId, setYearId] = useState('');
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const schemes = useQuery<{ id: string; name_en: string; name_bn: string | null }[]>(
    (db) => db.from('grading_schemes').select('id,name_en,name_bn').eq('is_active', true).order('name_en'),
    [],
  );
  const terms = useQuery<AcademicTerm[]>(
    (db) => (yearId ? db.from('academic_terms').select('*').eq('academic_year_id', yearId).order('starts_on') : Promise.resolve({ data: [], error: null })),
    [yearId],
  );
  useEffect(() => {
    if (!yearId && years.state.status === 'ready' && years.state.data.length) {
      setYearId((years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id);
    }
  }, [years.state, yearId]);
  const { state, retry } = useQuery<ExamRow[]>(
    (db) =>
      yearId
        ? db.from('examinations').select('*,year:academic_years(name_en,name_bn)').eq('academic_year_id', yearId).order('starts_on', { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
    [yearId, reload],
  );

  const fields: EntityField[] = [
    { name: 'name_en', label: ex.fields.name_en, type: 'text', required: true, maxLength: 120 },
    { name: 'name_bn', label: ex.fields.name_bn, type: 'text', maxLength: 120, lang: 'bn' },
    {
      name: 'term_id',
      label: ex.fields.term,
      type: 'select',
      options: [{ value: '', label: '—' }, ...(terms.state.status === 'ready' ? terms.state.data.map((x) => ({ value: x.id, label: pick(x.name_en, x.name_bn) })) : [])],
    },
    {
      name: 'grading_scheme_id',
      label: ex.fields.scheme,
      type: 'select',
      required: true,
      options: [{ value: '', label: t.apply.select }, ...(schemes.state.status === 'ready' ? schemes.state.data.map((s) => ({ value: s.id, label: pick(s.name_en, s.name_bn) })) : [])],
    },
    {
      name: 'absent_policy',
      label: ex.fields.absent_policy,
      type: 'select',
      options: (['count_as_zero', 'mark_incomplete'] as const).map((p) => ({ value: p, label: ex.absentPolicies[p] })),
    },
    { name: 'starts_on', label: ex.fields.starts_on, type: 'date' },
    { name: 'ends_on', label: ex.fields.ends_on, type: 'date' },
  ];

  return (
    <>
      <AdminPageHeader
        title={ex.title}
        subtitle={ex.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={ex.fields.year} value={yearId} onChange={(e) => setYearId(e.target.value)} className={inputClass + ' w-auto'}>
              {years.state.status === 'ready' &&
                years.state.data.map((y) => (
                  <option key={y.id} value={y.id}>
                    {pick(y.name_en, y.name_bn)}
                  </option>
                ))}
            </select>
            {canManage && (
              <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary')}>
                <Plus className="h-4 w-4" aria-hidden />
                {ex.add}
              </button>
            )}
          </div>
        }
      />
      <p className="mb-4 text-xs text-slate-500">{ex.workflowHelp}</p>
      <Panel>
        <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
          {(rows) => (
            <ul className="divide-y divide-slate-100">
              {rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <Link to={e.id} className="font-semibold text-navy-900 hover:text-royal-700">
                      {pick(e.name_en, e.name_bn)}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {e.starts_on && formatDate(e.starts_on + 'T00:00:00', { day: 'numeric', month: 'short' })}
                      {e.ends_on && ` – ${formatDate(e.ends_on + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    </p>
                  </div>
                  <ExamStatusBadge status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>
      <EntityModal
        open={adding}
        title={ex.add}
        fields={fields}
        initial={{ name_en: '', name_bn: '', term_id: '', grading_scheme_id: '', absent_policy: 'count_as_zero', starts_on: '', ends_on: '' }}
        onClose={() => setAdding(false)}
        onSubmit={async (v) => {
          if (v.starts_on && v.ends_on && String(v.ends_on) < String(v.starts_on)) return t.admin.common.endBeforeStart;
          const { error } = await supabase!.from('examinations').insert({ ...toEntityPayload(fields, v), academic_year_id: yearId });
          if (error) return examError(t, error);
          setAdding(false);
          toast('success', t.admin.common.saved);
          setReload((n) => n + 1);
          return null;
        }}
      />
    </>
  );
}

// ====================================================================
type Tab = 'subjects' | 'marks' | 'results' | 'corrections' | 'history';

export function ExamDetailPage() {
  const { id = '' } = useParams();
  const { t, pick } = useLang();
  const ex = t.admin.exams;
  usePageMeta(ex.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, EXAM_MANAGE_ROLES);
  const canApprove = hasAnyRole(me, RESULT_APPROVE_ROLES);
  const [params, setParams] = useSearchParams();
  const tab = (['subjects', 'marks', 'results', 'corrections', 'history'] as Tab[]).includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'subjects';
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<{ to: ExamStatus; label: string } | null>(null);

  const exam = useQuery<(Exam & { year: { name_en: string; name_bn: string | null } | null }) | null>(
    (db) => db.from('examinations').select('*,year:academic_years(name_en,name_bn)').eq('id', id).maybeSingle(),
    [id, reload],
  );
  const e = exam.state.status === 'ready' ? exam.state.data : null;
  const actions = e
    ? EXAM_ACTIONS[e.status].filter((a) => (a.who === 'manage' ? canManage : a.who === 'approve' ? canApprove : canManage || canApprove))
    : [];

  return (
    <>
      <Link to="/admin/exams" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <QueryView state={exam.state} retry={exam.retry} empty={t.admin.common.noRecords} isEmpty={(d) => d === null}>
        {(x) =>
          x && (
            <>
              <AdminPageHeader
                title={pick(x.name_en, x.name_bn)}
                subtitle={x.year ? pick(x.year.name_en, x.year.name_bn) : undefined}
                actions={<ExamStatusBadge status={x.status} />}
              />
              {actions.length > 0 && (
                <Panel className="no-print mb-6">
                  <p className="mb-3 text-xs text-slate-500">{ex.workflowHelp}</p>
                  <div className="flex flex-wrap gap-2">
                    {actions.map((a, i) => (
                      <button
                        key={a.to}
                        type="button"
                        onClick={() => setAction({ to: a.to, label: ex.actions[a.label] })}
                        className={buttonClass(i === 0 ? (a.to === 'published' ? 'gold' : 'primary') : 'outline')}
                      >
                        {ex.actions[a.label]}
                      </button>
                    ))}
                  </div>
                </Panel>
              )}
              <div role="tablist" className="no-print mb-6 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                {(['subjects', 'marks', 'results', 'corrections', 'history'] as Tab[]).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    type="button"
                    aria-selected={tab === k}
                    onClick={() => setParams({ tab: k }, { replace: true })}
                    className={cx('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold', tab === k ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}
                  >
                    {ex.tabs[k]}
                  </button>
                ))}
              </div>
              {tab === 'subjects' && <SubjectsTab exam={x} canManage={canManage} />}
              {tab === 'marks' && <SectionPicker exam={x}>{(section, es) => es && <MarksEntry key={es + section} examSubjectId={es} sectionId={section} mode={canManage ? 'admin' : 'view'} />}</SectionPicker>}
              {tab === 'results' && (
                <SectionPicker exam={x} withoutSubject>
                  {(section) => (
                    <Panel>
                      <ResultsTable examId={x.id} sectionId={section} reportLink={(sid) => `/admin/exams/${x.id}/report/${sid}`} />
                    </Panel>
                  )}
                </SectionPicker>
              )}
              {tab === 'corrections' && <CorrectionsTab examId={x.id} canApprove={canApprove} />}
              {tab === 'history' && <HistoryTab examId={x.id} reload={reload} />}

              <StatusModal
                exam={x}
                action={action}
                onClose={() => setAction(null)}
                onDone={() => {
                  setAction(null);
                  setReload((n) => n + 1);
                }}
              />
            </>
          )
        }
      </QueryView>
    </>
  );
}

function StatusModal({ exam, action, onClose, onDone }: { exam: Exam; action: { to: ExamStatus; label: string } | null; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const ex = t.admin.exams;
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(''), [action]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!action) return;
    setBusy(true);
    const { error } = await supabase!.rpc('set_exam_status', { p_exam: exam.id, p_status: action.to, p_note: note.trim() || null });
    setBusy(false);
    if (error) return toast('error', examError(t, error));
    toast('success', ex.statusChanged);
    onDone();
  };
  return (
    <Modal open={action !== null} title={ex.confirmTitle} onClose={onClose}>
      {action && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm font-semibold text-navy-900">{action.label}</p>
          <InlineNotice tone={action.to === 'published' ? 'warning' : 'info'}>{action.to === 'published' ? ex.confirmPublish : ex.confirmGeneric}</InlineNotice>
          <TextAreaField label={ex.note} rows={2} maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={buttonClass('outline')}>
              {t.admin.common.cancel}
            </button>
            <button type="submit" disabled={busy} className={buttonClass(action.to === 'published' ? 'gold' : 'primary')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {action.label}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Section (and optionally subject) picker for an exam's year; renders children once chosen. */
function SectionPicker({
  exam,
  withoutSubject = false,
  children,
}: {
  exam: Exam;
  withoutSubject?: boolean;
  children: (sectionId: string, examSubjectId: string | null) => ReactNode;
}) {
  const { t, pick } = useLang();
  const mk = t.admin.exams.marks;
  const mediumLabel = useMediumLabel();
  const [params, setParams] = useSearchParams();
  const sectionId = params.get('section') ?? '';
  const esId = params.get('subject') ?? '';
  const sections = useYearSections(exam.academic_year_id);
  const subjects = useQuery<ExamSubject[]>(
    (db) => db.from('examination_subjects').select('*,subject:subjects(name_en,name_bn)').eq('examination_id', exam.id).order('sort_order'),
    [exam.id],
  );
  const section = sections.state.status === 'ready' ? sections.state.data.find((s) => s.id === sectionId) : undefined;
  const sectionSubjects =
    subjects.state.status === 'ready' && section ? subjects.state.data.filter((s) => s.class_id === section.class_id && s.medium === section.medium) : [];
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <Panel className="no-print mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <select aria-label={mk.section} value={sectionId} onChange={(e) => set({ section: e.target.value || null, subject: null })} className={inputClass}>
            <option value="">{mk.selectSection}</option>
            {sections.state.status === 'ready' &&
              sortSections(sections.state.data).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.class ? pick(s.class.name_en, s.class.name_bn) : ''} · {s.name} ({mediumLabel(s.medium)})
                </option>
              ))}
          </select>
          {!withoutSubject && (
            <select aria-label={mk.subject} value={esId} disabled={!section} onChange={(e) => set({ subject: e.target.value || null })} className={inputClass}>
              <option value="">{mk.selectSubject}</option>
              {sectionSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subject ? pick(s.subject.name_en, s.subject.name_bn) : s.subject_id}
                </option>
              ))}
            </select>
          )}
        </div>
        {section && !withoutSubject && sectionSubjects.length === 0 && subjects.state.status === 'ready' && (
          <p className="mt-3 text-sm text-slate-500">{mk.noSubjects}</p>
        )}
      </Panel>
      {sectionId && (withoutSubject || esId) && children(sectionId, esId || null)}
    </>
  );
}

function SubjectsTab({ exam, canManage }: { exam: Exam; canManage: boolean }) {
  const { t, lang, pick, formatDate } = useLang();
  const sx = t.admin.exams.subjects;
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const editable = canManage && (exam.status === 'draft' || exam.status === 'marks_entry');
  const [reload, setReload] = useState(0);
  const [classId, setClassId] = useState('');
  const [medium, setMedium] = useState<Medium>('bangla_medium');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ExamSubject | null>(null);
  const [toDelete, setToDelete] = useState<ExamSubject | null>(null);
  const classes = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('id,code,name_en,name_bn,level,is_active,class_streams(class_id,medium,admission_open)').eq('is_active', true).order('level'),
    [],
  );
  const { state, retry } = useQuery<ExamSubject[]>(
    (db) => db.from('examination_subjects').select('*,subject:subjects(name_en,name_bn),class:classes(name_en,name_bn,level)').eq('examination_id', exam.id),
    [exam.id, reload],
  );

  const grouped = useMemo(() => {
    const rows = state.status === 'ready' ? state.data : [];
    const map = new Map<string, ExamSubject[]>();
    for (const r of [...rows].sort((a, b) => (a.class?.level ?? 0) - (b.class?.level ?? 0) || a.medium.localeCompare(b.medium) || a.sort_order - b.sort_order)) {
      const k = `${r.class_id}:${r.medium}`;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.values()];
  }, [state]);

  const addFromCurriculum = async () => {
    if (!classId) return;
    setAdding(true);
    const { data: curriculum } = await supabase!.from('class_subjects').select('subject_id,sort_order').eq('class_id', classId).eq('medium', medium);
    const existing = new Set(state.status === 'ready' ? state.data.filter((s) => s.class_id === classId && s.medium === medium).map((s) => s.subject_id) : []);
    const rows = (curriculum ?? [])
      .filter((c) => !existing.has(c.subject_id))
      .map((c) => ({ examination_id: exam.id, class_id: classId, medium, subject_id: c.subject_id, full_marks: 100, pass_marks: 33, sort_order: c.sort_order }));
    const { error } = rows.length ? await supabase!.from('examination_subjects').insert(rows) : { error: null };
    setAdding(false);
    if (error) return toast('error', examError(t, error));
    toast('success', sx.added(rows.length));
    setReload((n) => n + 1);
  };

  const editFields: EntityField[] = [
    { name: 'full_marks', label: sx.fullMarks, type: 'number', required: true },
    { name: 'pass_marks', label: sx.passMarks, type: 'number', required: true },
    { name: 'exam_date', label: sx.examDate, type: 'date' },
    { name: 'include_in_total', label: sx.inTotal, type: 'checkbox' },
  ];

  return (
    <>
      {!editable && canManage && (
        <div className="mb-4">
          <InlineNotice>{sx.locked}</InlineNotice>
        </div>
      )}
      {editable && (
        <Panel className="mb-6" title={sx.addFromCurriculum}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select aria-label={sx.class} value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass}>
              <option value="">{t.admin.academics.selectClass}</option>
              {classes.state.status === 'ready' &&
                classes.state.data
                  .filter((c) => c.class_streams.some((s) => s.medium === medium))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {pick(c.name_en, c.name_bn)}
                    </option>
                  ))}
            </select>
            <select
              aria-label={sx.medium}
              value={medium}
              onChange={(e) => {
                setMedium(e.target.value as Medium);
                setClassId('');
              }}
              className={inputClass}
            >
              {MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {mediumLabel(m)}
                </option>
              ))}
            </select>
            <button type="button" onClick={addFromCurriculum} disabled={!classId || adding} className={buttonClass('primary', 'shrink-0')}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              {sx.addFromCurriculum}
            </button>
          </div>
        </Panel>
      )}
      <QueryView state={state} retry={retry} empty={sx.none}>
        {() => (
          <div className="space-y-6">
            {grouped.map((group) => {
              const first = group[0];
              return (
                <Panel key={`${first.class_id}:${first.medium}`} title={`${first.class ? pick(first.class.name_en, first.class.name_bn) : ''} · ${mediumLabel(first.medium)}`}>
                  <div className="-mx-5 overflow-x-auto sm:mx-0">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">{t.admin.exams.marks.subject}</th>
                          <th className="px-3 py-2 text-right font-semibold">{sx.fullMarks}</th>
                          <th className="px-3 py-2 text-right font-semibold">{sx.passMarks}</th>
                          <th className="px-3 py-2 font-semibold">{sx.examDate}</th>
                          <th className="px-3 py-2 font-semibold">{sx.inTotal}</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {group.map((s) => (
                          <tr key={s.id}>
                            <td className="px-3 py-2.5 font-medium text-navy-900">{s.subject ? pick(s.subject.name_en, s.subject.name_bn) : ''}</td>
                            <td className="px-3 py-2.5 text-right">{formatNumber(s.full_marks, lang, 0)}</td>
                            <td className="px-3 py-2.5 text-right">{formatNumber(s.pass_marks, lang, 0)}</td>
                            <td className="px-3 py-2.5 text-slate-600">{s.exam_date ? formatDate(s.exam_date + 'T00:00:00', { day: 'numeric', month: 'short' }) : '—'}</td>
                            <td className="px-3 py-2.5">{s.include_in_total ? t.admin.academics.yes : t.admin.academics.no}</td>
                            <td className="px-3 py-2.5 text-right">
                              {editable && (
                                <span className="inline-flex gap-1">
                                  <button type="button" onClick={() => setEditing(s)} className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700" aria-label={t.admin.common.edit}>
                                    <Pencil className="h-4 w-4" aria-hidden />
                                  </button>
                                  <button type="button" onClick={() => setToDelete(s)} className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600" aria-label={t.admin.common.delete}>
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </QueryView>
      <EntityModal
        open={editing !== null}
        title={editing?.subject ? pick(editing.subject.name_en, editing.subject.name_bn) : ''}
        fields={editFields}
        initial={{
          full_marks: String(editing?.full_marks ?? ''),
          pass_marks: String(editing?.pass_marks ?? ''),
          exam_date: editing?.exam_date ?? '',
          include_in_total: editing?.include_in_total ?? true,
        }}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const full = Number(v.full_marks);
          const pass = Number(v.pass_marks);
          if (!(full > 0 && full <= 1000) || !(pass >= 0 && pass <= full)) return t.admin.academics.invalid;
          const { error } = await supabase!.from('examination_subjects').update(toEntityPayload(editFields, v)).eq('id', editing!.id);
          if (error) return examError(t, error);
          setEditing(null);
          setReload((n) => n + 1);
          return null;
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={t.admin.common.confirmDeleteTitle}
        body={toDelete?.subject ? pick(toDelete.subject.name_en, toDelete.subject.name_bn) : ''}
        confirmLabel={t.admin.common.delete}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const { error } = await supabase!.from('examination_subjects').delete().eq('id', toDelete!.id);
          setToDelete(null);
          if (error) toast('error', examError(t, error));
          else setReload((n) => n + 1);
        }}
      />
    </>
  );
}

interface MarksCorrection {
  id: string;
  requested_marks: number | null;
  requested_status: MarkStatus;
  reason: string;
  requested_by: string | null;
  requested_at: string;
  mark: {
    marks: number | null;
    mark_status: MarkStatus;
    student: { name_en: string; name_bn: string | null; student_code: string } | null;
    es: { examination_id: string; full_marks: number; subject: { name_en: string; name_bn: string | null } | null } | null;
  } | null;
}

function CorrectionsTab({ examId, canApprove }: { examId: string; canApprove: boolean }) {
  const { t, lang, pick, formatDate } = useLang();
  const c = t.admin.exams.corrections;
  const mk = t.admin.exams.marks;
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { state, retry } = useQuery<MarksCorrection[]>(
    (db) =>
      db
        .from('marks_correction_requests')
        .select('id,requested_marks,requested_status,reason,requested_by,requested_at,mark:student_marks(marks,mark_status,student:students(name_en,name_bn,student_code),es:examination_subjects(examination_id,full_marks,subject:subjects(name_en,name_bn)))')
        .eq('status', 'pending')
        .order('requested_at'),
    [reload],
  );
  const rows = state.status === 'ready' ? state.data.filter((r) => r.mark?.es?.examination_id === examId) : [];
  const names = useActorNames(rows.map((r) => r.requested_by).filter((x): x is string => Boolean(x)));
  const show = (marks: number | null, status: MarkStatus) => (status === 'present' ? formatNumber(marks, lang) : mk.markStatuses[status]);

  const review = async (id: string, approve: boolean) => {
    setBusy(id);
    const { error } = await supabase!.rpc('review_marks_correction', { p_request: id, p_approve: approve, p_note: notes[id]?.trim() || null });
    setBusy(null);
    if (error) return toast('error', examError(t, error));
    toast('success', approve ? c.approved : c.rejected);
    setReload((n) => n + 1);
  };

  return (
    <Panel>
      <QueryView state={state} retry={retry} empty={c.none} isEmpty={() => rows.length === 0}>
        {() => (
          <ul className="space-y-4">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-navy-900">
                      {r.mark?.student ? pick(r.mark.student.name_en, r.mark.student.name_bn) : '—'}
                      <span className="ml-2 font-mono text-xs font-normal text-slate-400">{r.mark?.student?.student_code}</span>
                    </p>
                    <p className="text-xs text-slate-500">{r.mark?.es?.subject ? pick(r.mark.es.subject.name_en, r.mark.es.subject.name_bn) : ''}</p>
                    <p className="mt-2">
                      <span className="text-slate-500">{c.current}:</span> <strong>{r.mark ? show(r.mark.marks, r.mark.mark_status) : '—'}</strong>
                      <span className="mx-2 text-slate-400">→</span>
                      <strong className="text-royal-700">{show(r.requested_marks, r.requested_status)}</strong>
                    </p>
                    <p className="mt-1 text-slate-700">“{r.reason}”</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {r.requested_by ? names[r.requested_by] ?? '' : ''} · {formatDate(r.requested_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {canApprove && (
                    <div className="flex w-full flex-col gap-2 md:w-72">
                      <input
                        aria-label={t.admin.attendance.corrections.reviewNote}
                        placeholder={t.admin.attendance.corrections.reviewNote}
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
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

function HistoryTab({ examId, reload }: { examId: string; reload: number }) {
  const { t, formatDate } = useLang();
  const ex = t.admin.exams;
  const { state, retry } = useQuery<{ id: number; from_status: ExamStatus | null; to_status: ExamStatus; note: string | null; changed_by: string | null; changed_at: string }[]>(
    (db) => db.from('exam_status_history').select('*').eq('examination_id', examId).order('changed_at').order('id'),
    [examId, reload],
  );
  const names = useActorNames(state.status === 'ready' ? state.data.map((h) => h.changed_by).filter((x): x is string => Boolean(x)) : []);
  return (
    <Panel>
      <QueryView state={state} retry={retry} empty={t.admin.dashboard.noActivity}>
        {(rows) => (
          <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
            {rows.map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-royal-600" aria-hidden />
                <ExamStatusBadge status={h.to_status} />
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(h.changed_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {h.changed_by && names[h.changed_by] && ` · ${names[h.changed_by]}`}
                </p>
                {h.note && <p className="mt-1 text-sm text-slate-700">{h.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </QueryView>
      <p className="mt-4 text-xs text-slate-400">{ex.workflowHelp}</p>
    </Panel>
  );
}

export function AdminReportCardPage() {
  const { id = '', studentId = '' } = useParams();
  const { t } = useLang();
  usePageMeta(t.admin.exams.reportCard.title, undefined, { noindex: true });
  return (
    <>
      <Link to={`/admin/exams/${id}?tab=results`} className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <ReportCard examId={id} studentId={studentId} />
    </>
  );
}

// ====================================================================
interface Scheme {
  id: string;
  name_en: string;
  name_bn: string | null;
  overall_method: 'gpa' | 'percentage';
  fail_in_any_subject_fails: boolean;
  is_active: boolean;
  rules: { id: string; grade: string; min_percent: number; max_percent: number; grade_point: number | null; is_fail: boolean; remark_en: string | null; remark_bn: string | null }[];
}

export function GradingPage() {
  const { t, lang, pick } = useLang();
  const g = t.admin.grading;
  usePageMeta(g.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, EXAM_MANAGE_ROLES);
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<{ kind: 'scheme' | 'rule'; id?: string; schemeId?: string; initial: EntityValues } | null>(null);
  const [toDelete, setToDelete] = useState<{ id: string; label: string } | null>(null);
  const { state, retry } = useQuery<Scheme[]>((db) => db.from('grading_schemes').select('*,rules:grade_rules(*)').order('name_en'), [reload]);

  const schemeFields: EntityField[] = [
    { name: 'name_en', label: g.fields.name_en, type: 'text', required: true, maxLength: 100 },
    { name: 'name_bn', label: g.fields.name_bn, type: 'text', maxLength: 100, lang: 'bn' },
    { name: 'overall_method', label: g.fields.overall_method, type: 'select', options: (['gpa', 'percentage'] as const).map((m) => ({ value: m, label: g.methods[m] })), wide: true },
    { name: 'fail_in_any_subject_fails', label: g.fields.fail_in_any_subject_fails, type: 'checkbox', wide: true },
    { name: 'is_active', label: g.fields.is_active, type: 'checkbox' },
  ];
  const ruleFields: EntityField[] = [
    { name: 'grade', label: g.rule.grade, type: 'text', required: true, maxLength: 10 },
    { name: 'grade_point', label: g.rule.gp, type: 'number' },
    { name: 'min_percent', label: g.rule.min, type: 'number', required: true },
    { name: 'max_percent', label: g.rule.max, type: 'number', required: true },
    { name: 'remark_en', label: g.rule.remark_en, type: 'text', maxLength: 50 },
    { name: 'remark_bn', label: g.rule.remark_bn, type: 'text', maxLength: 50, lang: 'bn' },
    { name: 'is_fail', label: g.rule.is_fail, type: 'checkbox' },
  ];

  const save = async (v: EntityValues) => {
    if (!modal) return null;
    let error;
    if (modal.kind === 'scheme') {
      const payload = toEntityPayload(schemeFields, v);
      ({ error } = modal.id
        ? await supabase!.from('grading_schemes').update(payload).eq('id', modal.id)
        : await supabase!.from('grading_schemes').insert(payload));
    } else {
      const min = Number(v.min_percent);
      const max = Number(v.max_percent);
      const gp = String(v.grade_point ?? '').trim();
      if (!(min >= 0 && max <= 100 && min <= max) || (gp && !(Number(gp) >= 0 && Number(gp) <= 5))) return t.admin.academics.invalid;
      const payload = { ...toEntityPayload(ruleFields, v), scheme_id: modal.schemeId };
      ({ error } = modal.id ? await supabase!.from('grade_rules').update(payload).eq('id', modal.id) : await supabase!.from('grade_rules').insert(payload));
    }
    if (error) return examError(t, error);
    setModal(null);
    toast('success', t.admin.common.saved);
    setReload((n) => n + 1);
    return null;
  };

  return (
    <>
      <AdminPageHeader
        title={g.title}
        subtitle={g.subtitle}
        actions={
          canManage && (
            <button
              type="button"
              className={buttonClass('primary')}
              onClick={() => setModal({ kind: 'scheme', initial: { name_en: '', name_bn: '', overall_method: 'gpa', fail_in_any_subject_fails: true, is_active: true } })}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {g.add}
            </button>
          )
        }
      />
      <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
        {(schemes) => (
          <div className="space-y-6">
            {schemes.map((s) => (
              <Panel
                key={s.id}
                title={pick(s.name_en, s.name_bn)}
                actions={
                  canManage && (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className={buttonClass('ghost', 'px-2 py-1')}
                        onClick={() =>
                          setModal({ kind: 'rule', schemeId: s.id, initial: { grade: '', grade_point: '', min_percent: '', max_percent: '', remark_en: '', remark_bn: '', is_fail: false } })
                        }
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        {g.addRule}
                      </button>
                      <button
                        type="button"
                        className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700"
                        aria-label={t.admin.common.edit}
                        onClick={() =>
                          setModal({
                            kind: 'scheme',
                            id: s.id,
                            initial: { name_en: s.name_en, name_bn: s.name_bn ?? '', overall_method: s.overall_method, fail_in_any_subject_fails: s.fail_in_any_subject_fails, is_active: s.is_active },
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                    </span>
                  )
                }
              >
                <p className="mb-3 text-xs text-slate-500">
                  {g.fields.overall_method}: {g.methods[s.overall_method]}
                  {s.fail_in_any_subject_fails && ` · ${g.fields.fail_in_any_subject_fails}`}
                </p>
                {s.rules.length === 0 ? (
                  <p className="text-sm text-slate-500">{g.noRules}</p>
                ) : (
                  <div className="-mx-5 overflow-x-auto sm:mx-0">
                    <table className="w-full min-w-[480px] text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">{g.rule.grade}</th>
                          <th className="px-3 py-2 font-semibold">%</th>
                          <th className="px-3 py-2 text-right font-semibold">{g.rule.gp}</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[...s.rules]
                          .sort((a, b) => Number(b.min_percent) - Number(a.min_percent))
                          .map((r) => (
                            <tr key={r.id}>
                              <td className={cx('px-3 py-2 font-bold', r.is_fail ? 'text-red-700' : 'text-navy-900')}>{r.grade}</td>
                              <td className="px-3 py-2">
                                {formatNumber(r.min_percent, lang)} – {formatNumber(r.max_percent, lang)}
                              </td>
                              <td className="px-3 py-2 text-right">{formatNumber(r.grade_point, lang)}</td>
                              <td className="px-3 py-2 text-right">
                                {canManage && (
                                  <span className="inline-flex gap-1">
                                    <button
                                      type="button"
                                      className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700"
                                      aria-label={`${t.admin.common.edit}: ${r.grade}`}
                                      onClick={() =>
                                        setModal({
                                          kind: 'rule',
                                          id: r.id,
                                          schemeId: s.id,
                                          initial: {
                                            grade: r.grade,
                                            grade_point: r.grade_point == null ? '' : String(r.grade_point),
                                            min_percent: String(r.min_percent),
                                            max_percent: String(r.max_percent),
                                            remark_en: r.remark_en ?? '',
                                            remark_bn: r.remark_bn ?? '',
                                            is_fail: r.is_fail,
                                          },
                                        })
                                      }
                                    >
                                      <Pencil className="h-4 w-4" aria-hidden />
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                                      aria-label={`${t.admin.common.delete}: ${r.grade}`}
                                      onClick={() => setToDelete({ id: r.id, label: r.grade })}
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden />
                                    </button>
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
      </QueryView>
      <EntityModal
        open={modal !== null}
        title={modal?.kind === 'rule' ? g.addRule : g.add}
        fields={modal?.kind === 'rule' ? ruleFields : schemeFields}
        initial={modal?.initial ?? {}}
        onClose={() => setModal(null)}
        onSubmit={save}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={t.admin.common.confirmDeleteTitle}
        body={toDelete?.label ?? ''}
        confirmLabel={t.admin.common.delete}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const { error } = await supabase!.from('grade_rules').delete().eq('id', toDelete!.id);
          setToDelete(null);
          if (error) toast('error', examError(t, error));
          else setReload((n) => n + 1);
        }}
      />
    </>
  );
}
