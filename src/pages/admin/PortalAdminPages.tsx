import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { TEACHING_ADMIN_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import type { AcademicYear, ClassWithStreams, Medium } from '@/lib/academics';
import { QueryView, buttonClass, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, InlineNotice, Panel, useToast } from '@/components/admin/adminUi';
import { EntityModal, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { useMediumLabel } from '@/components/admissions';
import { EditableTimetable, timetableError, usePeriods, type Period } from '@/components/timetable/Timetable';
import { AddResourceModal, RESOURCE_SELECT, ResourceList, type LearningResource, type ResourceTarget } from '@/components/resources/Resources';
import { sortSections, useYearSections } from './AttendanceAdminPages';

function useYearPicker() {
  const years = useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
  const [yearId, setYearId] = useState('');
  useEffect(() => {
    if (!yearId && years.state.status === 'ready' && years.state.data.length) {
      setYearId((years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id);
    }
  }, [years.state, yearId]);
  return { years, yearId, setYearId };
}

function YearSelect({ years, value, onChange }: { years: ReturnType<typeof useYearPicker>['years']; value: string; onChange: (v: string) => void }) {
  const { t, pick } = useLang();
  return (
    <select aria-label={t.admin.exams.fields.year} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass + ' w-auto'}>
      {years.state.status === 'ready' &&
        years.state.data.map((y) => (
          <option key={y.id} value={y.id}>
            {pick(y.name_en, y.name_bn)}
          </option>
        ))}
    </select>
  );
}

// ====================================================================
export function TimetableAdminPage() {
  const { t, pick } = useLang();
  const tt = t.admin.timetable;
  usePageMeta(tt.title, undefined, { noindex: true });
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const { years, yearId, setYearId } = useYearPicker();
  const [sectionId, setSectionId] = useState('');
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<{ id?: string; initial: EntityValues } | null>(null);
  const [toDelete, setToDelete] = useState<Period | null>(null);
  const periods = usePeriods(yearId, reload);
  const sections = useYearSections(yearId);
  const section = sections.state.status === 'ready' ? sections.state.data.find((s) => s.id === sectionId) : undefined;

  const fields: EntityField[] = [
    { name: 'period_no', label: tt.fields.period_no, type: 'number', required: true },
    { name: 'is_break', label: tt.fields.is_break, type: 'checkbox' },
    { name: 'name_en', label: tt.fields.name_en, type: 'text', maxLength: 40 },
    { name: 'name_bn', label: tt.fields.name_bn, type: 'text', maxLength: 40, lang: 'bn' },
    { name: 'starts_at', label: tt.fields.starts_at, type: 'text', required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, hint: 'HH:MM' },
    { name: 'ends_at', label: tt.fields.ends_at, type: 'text', required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, hint: 'HH:MM' },
  ];

  return (
    <>
      <AdminPageHeader title={tt.title} subtitle={tt.subtitle} actions={<YearSelect years={years} value={yearId} onChange={(v) => { setYearId(v); setSectionId(''); }} />} />
      <Panel
        title={tt.periods}
        actions={
          <button
            type="button"
            className={buttonClass('ghost', 'px-2 py-1')}
            onClick={() =>
              setModal({
                initial: {
                  period_no: String((periods.state.status === 'ready' ? periods.state.data.length : 0) + 1),
                  is_break: false,
                  name_en: '',
                  name_bn: '',
                  starts_at: '',
                  ends_at: '',
                },
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            {tt.addPeriod}
          </button>
        }
      >
        <QueryView state={periods.state} retry={periods.retry} empty={tt.noPeriods}>
          {(rows) => (
            <ul className="flex flex-wrap gap-2">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-1 rounded-lg border border-slate-200 py-1 pl-3 pr-1 text-sm">
                  <span className={p.is_break ? 'text-gold-600' : 'text-navy-900'}>
                    <strong>{pick(p.name_en, p.name_bn) || p.period_no}</strong> {p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)}
                  </span>
                  <button
                    type="button"
                    aria-label={t.admin.common.edit}
                    className="rounded p-1.5 text-slate-500 hover:bg-royal-50 hover:text-royal-700"
                    onClick={() =>
                      setModal({
                        id: p.id,
                        initial: { period_no: String(p.period_no), is_break: p.is_break, name_en: p.name_en ?? '', name_bn: p.name_bn ?? '', starts_at: p.starts_at.slice(0, 5), ends_at: p.ends_at.slice(0, 5) },
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" aria-label={t.admin.common.delete} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" onClick={() => setToDelete(p)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Panel>

      <Panel className="mt-6">
        <select aria-label={tt.selectSection} value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={inputClass + ' mb-4 sm:w-96'}>
          <option value="">{tt.selectSection}</option>
          {sections.state.status === 'ready' &&
            sortSections(sections.state.data).map((s) => (
              <option key={s.id} value={s.id}>
                {s.class ? pick(s.class.name_en, s.class.name_bn) : ''} · {s.name} ({mediumLabel(s.medium)})
              </option>
            ))}
        </select>
        {section && <EditableTimetable key={section.id} sectionId={section.id} yearId={yearId} classId={section.class_id} medium={section.medium} />}
      </Panel>

      <EntityModal
        open={modal !== null}
        title={tt.addPeriod}
        fields={fields}
        initial={modal?.initial ?? {}}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          const payload = { ...toEntityPayload(fields, v), academic_year_id: yearId };
          const { error } = modal?.id ? await supabase!.from('timetable_periods').update(payload).eq('id', modal.id) : await supabase!.from('timetable_periods').insert(payload);
          if (error) return timetableError(t, error);
          setModal(null);
          setReload((n) => n + 1);
          return null;
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={t.admin.common.confirmDeleteTitle}
        body={toDelete ? `${toDelete.period_no}: ${toDelete.starts_at.slice(0, 5)}–${toDelete.ends_at.slice(0, 5)}` : ''}
        confirmLabel={t.admin.common.delete}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const { error } = await supabase!.from('timetable_periods').delete().eq('id', toDelete!.id);
          setToDelete(null);
          if (error) toast('error', timetableError(t, error));
          else setReload((n) => n + 1);
        }}
      />
    </>
  );
}

// ====================================================================
export function ResourcesAdminPage() {
  const { t, pick } = useLang();
  const r = t.admin.resources;
  usePageMeta(r.title, undefined, { noindex: true });
  const { me } = useAuth();
  const isAdmin = hasAnyRole(me, TEACHING_ADMIN_ROLES);
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const { years, yearId, setYearId } = useYearPicker();
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const classes = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('id,code,name_en,name_bn,level,is_active,class_streams(class_id,medium,admission_open)').eq('is_active', true).order('level'),
    [],
  );
  const sections = useYearSections(yearId);
  const list = useQuery<LearningResource[]>(
    (db) => (yearId ? db.from('learning_resources').select(RESOURCE_SELECT).eq('academic_year_id', yearId).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null })),
    [yearId, reload],
  );

  const targets = useMemo<ResourceTarget[]>(() => {
    if (classes.state.status !== 'ready' || sections.state.status !== 'ready') return [];
    const out: ResourceTarget[] = [];
    for (const c of classes.state.data) {
      for (const s of c.class_streams) {
        const m = s.medium as Medium;
        out.push({ value: `class:${c.id}:${m}`, label: `${pick(c.name_en, c.name_bn)} (${mediumLabel(m)}) — ${r.fields.allSections}`, yearId, classId: c.id, medium: m, sectionId: null });
        for (const sec of sortSections(sections.state.data).filter((x) => x.class_id === c.id && x.medium === m)) {
          out.push({ value: sec.id, label: `${pick(c.name_en, c.name_bn)} · ${sec.name} (${mediumLabel(m)})`, yearId, classId: c.id, medium: m, sectionId: sec.id });
        }
      }
    }
    return out;
  }, [classes.state, sections.state, yearId, pick, mediumLabel, r.fields.allSections]);

  return (
    <>
      <AdminPageHeader
        title={r.title}
        subtitle={r.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <YearSelect years={years} value={yearId} onChange={setYearId} />
            {isAdmin && (
              <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary')}>
                <Plus className="h-4 w-4" aria-hidden />
                {r.add}
              </button>
            )}
          </div>
        }
      />
      <div className="mb-4">
        <InlineNotice>{r.help}</InlineNotice>
      </div>
      <Panel>
        <QueryView state={list.state} retry={list.retry} empty={t.admin.common.noRecords}>
          {(rows) => <ResourceList resources={rows} showClass canDelete={() => isAdmin} onDeleted={() => setReload((n) => n + 1)} />}
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

// ====================================================================
interface LinkRequest {
  id: string;
  user_id: string;
  student_code: string;
  guardian_phone: string;
  relationship: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  review_note: string | null;
}

export function LinkRequestsPage() {
  const { t, formatDate } = useLang();
  const lr = t.admin.linkRequests;
  usePageMeta(lr.title, undefined, { noindex: true });
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { state, retry } = useQuery<LinkRequest[]>(
    (db) => db.from('guardian_link_requests').select('*').eq('status', 'pending').order('created_at'),
    [reload],
  );
  const accounts = useQuery<{ id: string; full_name: string; email: string | null }[]>(
    (db) => {
      const ids = state.status === 'ready' ? state.data.map((r) => r.user_id) : [];
      return ids.length ? db.from('user_profiles').select('id,full_name,email').in('id', ids) : Promise.resolve({ data: [], error: null });
    },
    [state],
  );
  const accountMap = new Map((accounts.state.status === 'ready' ? accounts.state.data : []).map((a) => [a.id, a]));

  const review = async (id: string, approve: boolean) => {
    setBusy(id);
    const { error } = await supabase!.rpc('review_guardian_link_request', { p_request: id, p_approve: approve, p_note: notes[id]?.trim() || null });
    setBusy(null);
    if (error) return toast('error', lr.errors[error.message] ?? lr.errors[error.code] ?? lr.errors.generic);
    toast('success', approve ? lr.approved : lr.rejected);
    setReload((n) => n + 1);
  };

  return (
    <>
      <AdminPageHeader title={lr.title} subtitle={lr.subtitle} />
      <div className="mb-4">
        <InlineNotice tone="warning">{lr.approveHelp}</InlineNotice>
      </div>
      <Panel>
        <QueryView state={state} retry={retry} empty={lr.empty}>
          {(rows) => (
            <ul className="space-y-4">
              {rows.map((r) => {
                const acct = accountMap.get(r.user_id);
                return (
                  <li key={r.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:justify-between">
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        <dt className="text-slate-500">{lr.requester}</dt>
                        <dd className="font-medium text-navy-900">
                          {acct?.full_name || '—'} <span className="block text-xs text-slate-500">{acct?.email}</span>
                        </dd>
                        <dt className="text-slate-500">{lr.studentCode}</dt>
                        <dd className="font-mono font-semibold text-navy-900">{r.student_code}</dd>
                        <dt className="text-slate-500">{lr.phone}</dt>
                        <dd className="font-mono text-navy-900">{r.guardian_phone}</dd>
                        <dt className="text-slate-500">{lr.relationship}</dt>
                        <dd className="text-navy-900">{r.relationship}</dd>
                        <dt className="text-slate-500">{t.admin.audit.time}</dt>
                        <dd className="text-slate-600">{formatDate(r.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</dd>
                      </dl>
                      <div className="flex w-full flex-col gap-2 md:w-72">
                        <input
                          aria-label={t.admin.attendance.corrections.reviewNote}
                          placeholder={t.admin.attendance.corrections.reviewNote}
                          value={notes[r.id] ?? ''}
                          maxLength={300}
                          onChange={(e) => setNotes((x) => ({ ...x, [r.id]: e.target.value }))}
                          className={inputClass}
                        />
                        <div className="flex gap-2">
                          <button type="button" disabled={busy !== null} onClick={() => review(r.id, true)} className={buttonClass('primary', 'flex-1')}>
                            {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                            {lr.approve}
                          </button>
                          <button type="button" disabled={busy !== null} onClick={() => review(r.id, false)} className={buttonClass('outline', 'flex-1 text-red-700')}>
                            <X className="h-4 w-4" aria-hidden />
                            {lr.reject}
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryView>
      </Panel>
    </>
  );
}
