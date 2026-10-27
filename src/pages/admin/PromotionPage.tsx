import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { MEDIUMS, type AcademicYear, type ClassWithStreams, type Medium } from '@/lib/academics';
import { QueryView, buttonClass, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, Panel, useToast } from '@/components/admin/adminUi';
import { useMediumLabel } from '@/components/admissions';
import { studentError } from './StudentsPages';

type Action = 'promote' | 'retain' | 'graduate' | 'skip';
const ACTIONS: Action[] = ['promote', 'retain', 'graduate', 'skip'];

interface Row {
  id: string;
  student_id: string;
  roll_no: number | null;
  student: { name_en: string; name_bn: string | null; student_code: string } | null;
  section: { name: string } | null;
}
interface Plan {
  action: Action;
  class_id: string;
  section_id: string;
}

export default function PromotionPage() {
  const { t, pick, lang } = useLang();
  const p = t.admin.promotion;
  usePageMeta(p.title, undefined, { noindex: true });
  const toast = useToast();
  const mediumLabel = useMediumLabel();

  const years = useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on'), []);
  const classes = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('id,code,name_en,name_bn,level,is_active,class_streams(class_id,medium,admission_open)').eq('is_active', true).order('level'),
    [],
  );
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [medium, setMedium] = useState<Medium>('bangla_medium');
  const [classId, setClassId] = useState('');
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  // Default: current year → the next year by start date.
  useEffect(() => {
    if (fromYear || years.state.status !== 'ready' || !years.state.data.length) return;
    const list = years.state.data;
    const current = list.find((y) => y.is_current) ?? list[0];
    setFromYear(current.id);
    const next = list.find((y) => y.starts_on > current.starts_on);
    if (next) setToYear(next.id);
  }, [years.state, fromYear]);

  const streamClasses = useMemo(
    () => (classes.state.status === 'ready' ? classes.state.data.filter((c) => c.class_streams.some((s) => s.medium === medium)) : []),
    [classes.state, medium],
  );
  const current = streamClasses.find((c) => c.id === classId);
  const nextClass = current ? streamClasses.find((c) => c.level > current.level) : undefined;

  const rows = useQuery<Row[]>(
    (db) =>
      fromYear && classId
        ? db
            .from('student_enrollments')
            .select('id,student_id,roll_no,student:students(name_en,name_bn,student_code),section:sections(name)')
            .eq('academic_year_id', fromYear)
            .eq('class_id', classId)
            .eq('medium', medium)
            .eq('status', 'enrolled')
        : Promise.resolve({ data: [], error: null }),
    [fromYear, classId, medium, reload],
  );
  const targetSections = useQuery<{ id: string; name: string; class_id: string }[]>(
    (db) =>
      toYear
        ? db.from('sections').select('id,name,class_id').eq('academic_year_id', toYear).eq('medium', medium).order('name')
        : Promise.resolve({ data: [], error: null }),
    [toYear, medium],
  );

  useEffect(() => {
    if (rows.state.status !== 'ready') return;
    const defaultPlan: Plan = nextClass
      ? { action: 'promote', class_id: nextClass.id, section_id: '' }
      : { action: 'graduate', class_id: '', section_id: '' };
    setPlans(Object.fromEntries(rows.state.data.map((r) => [r.student_id, { ...defaultPlan }])));
  }, [rows.state, nextClass]);

  const sorted = rows.state.status === 'ready'
    ? [...rows.state.data].sort((a, b) => (a.section?.name ?? '').localeCompare(b.section?.name ?? '') || (a.roll_no ?? 9999) - (b.roll_no ?? 9999))
    : [];
  const sectionsFor = (cid: string) => (targetSections.state.status === 'ready' ? targetSections.state.data.filter((s) => s.class_id === cid) : []);
  const selected = Object.entries(plans).filter(([, plan]) => plan.action !== 'skip');
  const missingClass = selected.some(([, plan]) => plan.action === 'promote' && !plan.class_id);

  const update = (studentId: string, change: Partial<Plan>) =>
    setPlans((x) => {
      const next = { ...x[studentId], ...change };
      if (change.class_id !== undefined || change.action) next.section_id = change.section_id ?? '';
      if (next.action === 'retain') next.class_id = classId;
      return { ...x, [studentId]: next };
    });

  const setAll = (action: Action) =>
    setPlans((x) =>
      Object.fromEntries(
        Object.keys(x).map((sid) => [
          sid,
          { action, class_id: action === 'promote' ? nextClass?.id ?? '' : action === 'retain' ? classId : '', section_id: '' },
        ]),
      ),
    );

  const process = async () => {
    setBusy(true);
    const items = selected.map(([student_id, plan]) => ({
      student_id,
      action: plan.action,
      class_id: plan.action === 'promote' ? plan.class_id : null,
      section_id: plan.action === 'graduate' ? null : plan.section_id || null,
    }));
    const { data, error } = await supabase!.rpc('promote_students', { p_from_year: fromYear, p_to_year: toYear, p_items: items });
    setBusy(false);
    setConfirming(false);
    if (error) return toast('error', studentError(t, error));
    toast('success', p.done(Number(data)));
    setReload((n) => n + 1);
  };

  const yearOptions = years.state.status === 'ready' ? years.state.data : [];
  const sel = inputClass;
  return (
    <>
      <AdminPageHeader title={p.title} subtitle={p.subtitle} />
      <Panel>
        <p className="mb-4 text-sm text-slate-600">{p.help}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-navy-800">
            {p.from}
            <select value={fromYear} onChange={(e) => setFromYear(e.target.value)} className={sel + ' mt-1.5'}>
              {yearOptions.map((y) => (
                <option key={y.id} value={y.id}>
                  {pick(y.name_en, y.name_bn)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-800">
            {p.to}
            <select value={toYear} onChange={(e) => setToYear(e.target.value)} className={sel + ' mt-1.5'}>
              <option value="">{t.apply.select}</option>
              {yearOptions
                .filter((y) => {
                  const from = yearOptions.find((x) => x.id === fromYear);
                  return !from || y.starts_on > from.starts_on;
                })
                .map((y) => (
                  <option key={y.id} value={y.id}>
                    {pick(y.name_en, y.name_bn)}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-800">
            {t.admin.students.fields.medium}
            <select
              value={medium}
              onChange={(e) => {
                setMedium(e.target.value as Medium);
                setClassId('');
              }}
              className={sel + ' mt-1.5'}
            >
              {MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {mediumLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-800">
            {t.admin.students.fields.class}
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className={sel + ' mt-1.5'}>
              <option value="">{t.admin.academics.selectClass}</option>
              {streamClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.name_en, c.name_bn)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      {classId && (
        <Panel className="mt-6">
          <QueryView state={rows.state} retry={rows.retry} empty={p.noStudents}>
            {() => (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-600">{p.setAll}:</span>
                  {ACTIONS.map((a) => (
                    <button key={a} type="button" onClick={() => setAll(a)} className={buttonClass('outline', 'px-3 py-1 text-xs')} disabled={a === 'promote' && !nextClass}>
                      {p.actions[a]}
                    </button>
                  ))}
                </div>
                <div className="-mx-5 overflow-x-auto sm:mx-0">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">{t.admin.students.columns.name}</th>
                        <th className="px-3 py-2 font-semibold">{t.admin.students.fields.section}</th>
                        <th className="px-3 py-2 font-semibold">{p.action}</th>
                        <th className="px-3 py-2 font-semibold">{p.targetClass}</th>
                        <th className="px-3 py-2 font-semibold">{p.targetSection}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sorted.map((r) => {
                        const plan = plans[r.student_id];
                        if (!plan) return null;
                        const label = r.student ? pick(r.student.name_en, r.student.name_bn) : r.student_id;
                        return (
                          <tr key={r.id}>
                            <td className="px-3 py-2">
                              <span className="font-medium text-navy-900">{label}</span>
                              <span className="block font-mono text-xs text-slate-500">{r.student?.student_code}</span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {r.section?.name ?? '—'}
                              {r.roll_no != null && ` · ${r.roll_no}`}
                            </td>
                            <td className="px-3 py-2">
                              <select aria-label={`${p.action}: ${label}`} value={plan.action} onChange={(e) => update(r.student_id, { action: e.target.value as Action, class_id: e.target.value === 'promote' ? nextClass?.id ?? '' : '' })} className={inputClass + ' py-1.5'}>
                                {ACTIONS.map((a) => (
                                  <option key={a} value={a}>
                                    {p.actions[a]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              {plan.action === 'promote' ? (
                                <select aria-label={`${p.targetClass}: ${label}`} value={plan.class_id} onChange={(e) => update(r.student_id, { class_id: e.target.value })} className={inputClass + ' py-1.5'}>
                                  <option value="">{t.apply.select}</option>
                                  {streamClasses
                                    .filter((c) => !current || c.level > current.level)
                                    .map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {pick(c.name_en, c.name_bn)}
                                      </option>
                                    ))}
                                </select>
                              ) : plan.action === 'retain' && current ? (
                                <span className="text-slate-600">{pick(current.name_en, current.name_bn)}</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {(plan.action === 'promote' || plan.action === 'retain') && plan.class_id ? (
                                <select aria-label={`${p.targetSection}: ${label}`} value={plan.section_id} onChange={(e) => update(r.student_id, { section_id: e.target.value })} className={inputClass + ' py-1.5'}>
                                  <option value="">—</option>
                                  {sectionsFor(plan.class_id).map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-5 flex items-center justify-end gap-3">
                  {missingClass && <p className="text-sm text-red-600">{t.admin.students.errors.MISSING_CLASS}</p>}
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={!toYear || selected.length === 0 || missingClass || busy}
                    className={buttonClass('primary')}
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {p.process} ({lang === 'bn' ? selected.length.toLocaleString('bn-BD') : selected.length})
                  </button>
                </div>
              </>
            )}
          </QueryView>
        </Panel>
      )}

      <ConfirmDialog
        open={confirming}
        title={p.confirmTitle}
        body={p.confirmBody(selected.length)}
        confirmLabel={p.process}
        danger={false}
        busy={busy}
        onConfirm={process}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
