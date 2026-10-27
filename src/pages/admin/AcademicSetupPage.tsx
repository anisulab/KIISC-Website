import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import {
  MEDIUMS,
  type AcademicTerm,
  type AcademicYear,
  type ClassWithStreams,
  type Medium,
  type Subject,
} from '@/lib/academics';
import { QueryView, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, InlineNotice, Panel, useToast } from '@/components/admin/adminUi';
import { EntityModal, entityErrorMessage, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { useMediumLabel } from '@/components/admissions';

type Tab = 'years' | 'classes' | 'sections' | 'subjects' | 'curriculum';
const TABS: Tab[] = ['years', 'classes', 'sections', 'subjects', 'curriculum'];
const CODE_RE = /^[a-z0-9-]{1,30}$/;
const YEAR_CODE_RE = /^[0-9]{4}(-[0-9]{2,4})?$/;

type ModalState = { title: string; fields: EntityField[]; initial: EntityValues; save: (v: EntityValues) => Promise<string | null> } | null;
type DeleteState = { label: string; run: () => Promise<string | null> } | null;

/** Shared modal + delete-confirmation plumbing for every tab. */
function useEditors(onChanged: () => void) {
  const { t } = useLang();
  const toast = useToast();
  const [modal, setModal] = useState<ModalState>(null);
  const [toDelete, setToDelete] = useState<DeleteState>(null);
  const [deleting, setDeleting] = useState(false);

  const ui = (
    <>
      <EntityModal
        open={modal !== null}
        title={modal?.title ?? ''}
        fields={modal?.fields ?? []}
        initial={modal?.initial ?? {}}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          const err = await modal!.save(v);
          if (!err) {
            setModal(null);
            toast('success', t.admin.common.saved);
            onChanged();
          }
          return err;
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={t.admin.common.confirmDeleteTitle}
        body={`"${toDelete?.label ?? ''}"`}
        confirmLabel={t.admin.common.delete}
        busy={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          setDeleting(true);
          const err = await toDelete!.run();
          setDeleting(false);
          setToDelete(null);
          if (err) toast('error', err);
          else {
            toast('success', t.admin.common.deleted);
            onChanged();
          }
        }}
      />
    </>
  );
  return { ui, setModal, setToDelete };
}

function useMessages() {
  const { t } = useLang();
  return (code?: string) => entityErrorMessage(code, t.admin.academics);
}

function RowActions({ onEdit, onDelete, label }: { onEdit: () => void; onDelete: () => void; label: string }) {
  const { t } = useLang();
  return (
    <div className="flex justify-end gap-1">
      <button type="button" onClick={onEdit} className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700" aria-label={`${t.admin.common.edit}: ${label}`}>
        <Pencil className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={onDelete} className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600" aria-label={`${t.admin.common.delete}: ${label}`}>
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
const td = 'px-3 py-3';

// ====================================================================
export default function AcademicSetupPage() {
  const { t } = useLang();
  const ac = t.admin.academics;
  usePageMeta(ac.title, undefined, { noindex: true });
  const [params, setParams] = useSearchParams();
  const tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'years';

  return (
    <>
      <AdminPageHeader title={ac.title} subtitle={ac.subtitle} />
      <div role="tablist" aria-label={ac.title} className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setParams({ tab: k }, { replace: true })}
            className={cx(
              'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition',
              tab === k ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50',
            )}
          >
            {ac.tabs[k]}
          </button>
        ))}
      </div>
      {tab === 'years' && <YearsTab />}
      {tab === 'classes' && <ClassesTab />}
      {tab === 'sections' && <SectionsTab />}
      {tab === 'subjects' && <SubjectsTab />}
      {tab === 'curriculum' && <CurriculumTab />}
    </>
  );
}

// ---------- Years & terms -------------------------------------------------
function YearsTab() {
  const { t, pick, formatDate } = useLang();
  const ac = t.admin.academics;
  const msg = useMessages();
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { ui, setModal, setToDelete } = useEditors(() => setReload((n) => n + 1));
  const { state, retry } = useQuery<(AcademicYear & { academic_terms: AcademicTerm[] })[]>(
    (db) => db.from('academic_years').select('*,academic_terms(*)').order('starts_on', { ascending: false }),
    [reload],
  );

  const yearFields: EntityField[] = [
    { name: 'code', label: ac.fields.code, type: 'text', required: true, pattern: YEAR_CODE_RE, hint: ac.yearCodeHint, maxLength: 9 },
    { name: 'name_en', label: ac.fields.name_en, type: 'text', required: true, maxLength: 50 },
    { name: 'name_bn', label: ac.fields.name_bn, type: 'text', maxLength: 50, lang: 'bn' },
    { name: 'starts_on', label: ac.fields.starts_on, type: 'date', required: true },
    { name: 'ends_on', label: ac.fields.ends_on, type: 'date', required: true },
    { name: 'is_current', label: ac.fields.is_current, type: 'checkbox' },
    { name: 'admission_open', label: ac.fields.admission_open, type: 'checkbox' },
  ];
  const termFields: EntityField[] = [
    { name: 'name_en', label: ac.fields.name_en, type: 'text', required: true, maxLength: 80 },
    { name: 'name_bn', label: ac.fields.name_bn, type: 'text', maxLength: 80, lang: 'bn' },
    { name: 'starts_on', label: ac.fields.starts_on, type: 'date', required: true },
    { name: 'ends_on', label: ac.fields.ends_on, type: 'date', required: true },
  ];

  const saveYear = (id?: string) => async (v: EntityValues) => {
    if (!supabase) return ac.invalid;
    if (String(v.ends_on) <= String(v.starts_on)) return t.admin.common.endBeforeStart;
    const payload = toEntityPayload(yearFields, v);
    // Only one current year: clear the flag elsewhere first.
    if (payload.is_current) {
      const clear = supabase.from('academic_years').update({ is_current: false }).eq('is_current', true);
      const { error } = id ? await clear.neq('id', id) : await clear;
      if (error) return msg(error.code);
    }
    const { error } = id
      ? await supabase.from('academic_years').update(payload).eq('id', id)
      : await supabase.from('academic_years').insert(payload);
    return error ? msg(error.code) : null;
  };

  const saveTerm = (yearId: string, id?: string) => async (v: EntityValues) => {
    if (!supabase) return ac.invalid;
    if (String(v.ends_on) <= String(v.starts_on)) return t.admin.common.endBeforeStart;
    const payload = { ...toEntityPayload(termFields, v), academic_year_id: yearId };
    const { error } = id
      ? await supabase.from('academic_terms').update(payload).eq('id', id)
      : await supabase.from('academic_terms').insert(payload);
    return error ? msg(error.code) : null;
  };

  const del = (table: string, id: string) => async () => {
    const { error } = await supabase!.from(table).delete().eq('id', id);
    return error ? msg(error.code) : null;
  };

  return (
    <Panel
      actions={
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={() =>
            setModal({
              title: `${ac.add}: ${ac.tabs.years}`,
              fields: yearFields,
              initial: { code: '', name_en: '', name_bn: '', starts_on: '', ends_on: '', is_current: false, admission_open: false },
              save: saveYear(),
            })
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
          {ac.add}
        </button>
      }
      title={ac.tabs.years}
    >
      <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
        {(rows) => (
          <div className="-mx-5 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className={th} />
                  <th className={th}>{ac.fields.name_en}</th>
                  <th className={th}>{ac.fields.starts_on}</th>
                  <th className={th}>{ac.fields.is_current}</th>
                  <th className={th}>{ac.fields.admission_open}</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((y) => {
                  const open = expanded === y.id;
                  const terms = [...y.academic_terms].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
                  return [
                    <tr key={y.id}>
                      <td className={td}>
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : y.id)}
                          aria-expanded={open}
                          aria-label={ac.terms}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100"
                        >
                          {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                        </button>
                      </td>
                      <td className={td}>
                        <span className="font-medium text-navy-900">{pick(y.name_en, y.name_bn)}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">{y.code}</span>
                      </td>
                      <td className={cx(td, 'whitespace-nowrap text-slate-600')}>
                        {formatDate(y.starts_on + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })} –{' '}
                        {formatDate(y.ends_on + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className={td}>{y.is_current ? <YesBadge /> : '—'}</td>
                      <td className={td}>{y.admission_open ? <YesBadge /> : '—'}</td>
                      <td className={td}>
                        <RowActions
                          label={y.name_en}
                          onEdit={() =>
                            setModal({
                              title: `${t.admin.common.edit}: ${y.name_en}`,
                              fields: yearFields,
                              initial: {
                                code: y.code,
                                name_en: y.name_en,
                                name_bn: y.name_bn ?? '',
                                starts_on: y.starts_on,
                                ends_on: y.ends_on,
                                is_current: y.is_current,
                                admission_open: y.admission_open,
                              },
                              save: saveYear(y.id),
                            })
                          }
                          onDelete={() => setToDelete({ label: y.name_en, run: del('academic_years', y.id) })}
                        />
                      </td>
                    </tr>,
                    open && (
                      <tr key={`${y.id}-terms`} className="bg-slate-50">
                        <td />
                        <td colSpan={5} className="px-3 py-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{ac.terms}</p>
                            <button
                              type="button"
                              className={buttonClass('ghost', 'px-2 py-1 text-xs')}
                              onClick={() =>
                                setModal({
                                  title: `${ac.addTerm}: ${y.name_en}`,
                                  fields: termFields,
                                  initial: { name_en: '', name_bn: '', starts_on: '', ends_on: '' },
                                  save: saveTerm(y.id),
                                })
                              }
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden />
                              {ac.addTerm}
                            </button>
                          </div>
                          {terms.length === 0 ? (
                            <p className="py-2 text-sm text-slate-500">{ac.noTerms}</p>
                          ) : (
                            <ul className="mt-1 divide-y divide-slate-200">
                              {terms.map((term) => (
                                <li key={term.id} className="flex items-center justify-between gap-3 py-1.5">
                                  <span className="text-sm text-navy-900">
                                    {pick(term.name_en, term.name_bn)}{' '}
                                    <span className="text-xs text-slate-500">
                                      ({formatDate(term.starts_on + 'T00:00:00', { day: 'numeric', month: 'short' })} –{' '}
                                      {formatDate(term.ends_on + 'T00:00:00', { day: 'numeric', month: 'short' })})
                                    </span>
                                  </span>
                                  <RowActions
                                    label={term.name_en}
                                    onEdit={() =>
                                      setModal({
                                        title: `${t.admin.common.edit}: ${term.name_en}`,
                                        fields: termFields,
                                        initial: {
                                          name_en: term.name_en,
                                          name_bn: term.name_bn ?? '',
                                          starts_on: term.starts_on,
                                          ends_on: term.ends_on,
                                        },
                                        save: saveTerm(y.id, term.id),
                                      })
                                    }
                                    onDelete={() => setToDelete({ label: term.name_en, run: del('academic_terms', term.id) })}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      {ui}
    </Panel>
  );
}

function YesBadge() {
  const { t } = useLang();
  return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{t.admin.academics.yes}</span>;
}

// ---------- Classes & streams ---------------------------------------------
function ClassesTab() {
  const { t, pick } = useLang();
  const ac = t.admin.academics;
  const msg = useMessages();
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const [reload, setReload] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { ui, setModal, setToDelete } = useEditors(() => setReload((n) => n + 1));
  const { state, retry } = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('*,class_streams(class_id,medium,admission_open)').order('level'),
    [reload],
  );

  const fields: EntityField[] = [
    { name: 'code', label: ac.fields.code, type: 'text', required: true, pattern: CODE_RE, hint: ac.codeHint, maxLength: 30 },
    { name: 'level', label: ac.fields.level, type: 'number', required: true },
    { name: 'name_en', label: ac.fields.name_en, type: 'text', required: true, maxLength: 80 },
    { name: 'name_bn', label: ac.fields.name_bn, type: 'text', maxLength: 80, lang: 'bn' },
    { name: 'is_active', label: ac.fields.is_active, type: 'checkbox' },
  ];

  const save = (id?: string) => async (v: EntityValues) => {
    const payload = toEntityPayload(fields, v);
    const { error } = id
      ? await supabase!.from('classes').update(payload).eq('id', id)
      : await supabase!.from('classes').insert(payload);
    return error ? msg(error.code) : null;
  };

  /** Turns a stream offering on/off, or toggles admission for it. */
  const toggle = async (c: ClassWithStreams, medium: Medium, what: 'offered' | 'admission') => {
    if (!supabase) return;
    const current = c.class_streams.find((s) => s.medium === medium);
    setBusyKey(`${c.id}:${medium}:${what}`);
    const { error } =
      what === 'offered'
        ? current
          ? await supabase.from('class_streams').delete().eq('class_id', c.id).eq('medium', medium)
          : await supabase.from('class_streams').insert({ class_id: c.id, medium, admission_open: false })
        : await supabase.from('class_streams').update({ admission_open: !current?.admission_open }).eq('class_id', c.id).eq('medium', medium);
    setBusyKey(null);
    if (error) toast('error', msg(error.code));
    setReload((n) => n + 1);
  };

  return (
    <Panel
      title={ac.tabs.classes}
      actions={
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={() =>
            setModal({
              title: `${ac.add}: ${ac.fields.class}`,
              fields,
              initial: { code: '', level: '', name_en: '', name_bn: '', is_active: true },
              save: save(),
            })
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
          {ac.add}
        </button>
      }
    >
      <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
        {(rows) => (
          <div className="-mx-5 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className={th}>{ac.fields.class}</th>
                  <th className={th}>{ac.fields.level}</th>
                  {MEDIUMS.map((m) => (
                    <th key={m} className={cx(th, 'text-center')}>
                      {mediumLabel(m)}
                      <span className="block text-[10px] font-medium normal-case text-slate-400">
                        {ac.offered} / {ac.fields.admission_open}
                      </span>
                    </th>
                  ))}
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} className={cx(!c.is_active && 'opacity-50')}>
                    <td className={td}>
                      <span className="font-medium text-navy-900">{pick(c.name_en, c.name_bn)}</span>
                      <span className="ml-2 font-mono text-xs text-slate-400">{c.code}</span>
                    </td>
                    <td className={cx(td, 'text-slate-600')}>{c.level}</td>
                    {MEDIUMS.map((m) => {
                      const s = c.class_streams.find((x) => x.medium === m);
                      return (
                        <td key={m} className={cx(td, 'text-center')}>
                          <span className="inline-flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={Boolean(s)}
                              disabled={busyKey !== null}
                              onChange={() => toggle(c, m, 'offered')}
                              aria-label={`${pick(c.name_en, c.name_bn)}, ${mediumLabel(m)}: ${ac.offered}`}
                              className="h-4 w-4 rounded border-navy-300 text-royal-600"
                            />
                            <input
                              type="checkbox"
                              checked={Boolean(s?.admission_open)}
                              disabled={!s || busyKey !== null}
                              onChange={() => toggle(c, m, 'admission')}
                              aria-label={`${pick(c.name_en, c.name_bn)}, ${mediumLabel(m)}: ${ac.fields.admission_open}`}
                              className="h-4 w-4 rounded border-gold-400 text-gold-500 disabled:opacity-30"
                            />
                          </span>
                        </td>
                      );
                    })}
                    <td className={td}>
                      <RowActions
                        label={c.name_en}
                        onEdit={() =>
                          setModal({
                            title: `${t.admin.common.edit}: ${c.name_en}`,
                            fields,
                            initial: { code: c.code, level: String(c.level), name_en: c.name_en, name_bn: c.name_bn ?? '', is_active: c.is_active },
                            save: save(c.id),
                          })
                        }
                        onDelete={() =>
                          setToDelete({
                            label: c.name_en,
                            run: async () => {
                              const { error } = await supabase!.from('classes').delete().eq('id', c.id);
                              return error ? msg(error.code) : null;
                            },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      {ui}
    </Panel>
  );
}

// ---------- Sections --------------------------------------------------------
interface SectionRow {
  id: string;
  academic_year_id: string;
  class_id: string;
  medium: Medium;
  name: string;
  capacity: number | null;
  class: { name_en: string; name_bn: string | null; level: number } | null;
}

function SectionsTab() {
  const { t, pick } = useLang();
  const ac = t.admin.academics;
  const msg = useMessages();
  const mediumLabel = useMediumLabel();
  const [reload, setReload] = useState(0);
  const [yearId, setYearId] = useState('');
  const [medium, setMedium] = useState<Medium>('bangla_medium');
  const { ui, setModal, setToDelete } = useEditors(() => setReload((n) => n + 1));

  const years = useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
  const classes = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('*,class_streams(class_id,medium,admission_open)').eq('is_active', true).order('level'),
    [],
  );
  useEffect(() => {
    if (!yearId && years.state.status === 'ready' && years.state.data.length) {
      setYearId((years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id);
    }
  }, [years.state, yearId]);

  const sections = useQuery<SectionRow[]>(
    (db) =>
      db
        .from('sections')
        .select('id,academic_year_id,class_id,medium,name,capacity,class:classes(name_en,name_bn,level)')
        .eq('academic_year_id', yearId || '00000000-0000-0000-0000-000000000000')
        .eq('medium', medium)
        .order('name'),
    [yearId, medium, reload],
  );

  const classOptions = useMemo(
    () =>
      classes.state.status === 'ready'
        ? classes.state.data
            .filter((c) => c.class_streams.some((s) => s.medium === medium))
            .map((c) => ({ value: c.id, label: pick(c.name_en, c.name_bn) }))
        : [],
    [classes.state, medium, pick],
  );

  const fields: EntityField[] = [
    { name: 'class_id', label: ac.fields.class, type: 'select', required: true, options: [{ value: '', label: t.apply.select }, ...classOptions] },
    { name: 'name', label: ac.fields.section_name, type: 'text', required: true, maxLength: 30 },
    { name: 'capacity', label: ac.fields.capacity, type: 'number' },
  ];

  const save = (id?: string) => async (v: EntityValues) => {
    const capacity = String(v.capacity ?? '').trim();
    if (capacity && !(Number(capacity) > 0)) return ac.invalid;
    const payload = { ...toEntityPayload(fields, v), academic_year_id: yearId, medium };
    const { error } = id
      ? await supabase!.from('sections').update(payload).eq('id', id)
      : await supabase!.from('sections').insert(payload);
    return error ? msg(error.code) : null;
  };

  const rows = sections.state.status === 'ready'
    ? [...sections.state.data].sort((a, b) => (a.class?.level ?? 0) - (b.class?.level ?? 0) || a.name.localeCompare(b.name))
    : [];

  return (
    <Panel
      title={ac.tabs.sections}
      actions={
        <button
          type="button"
          disabled={!yearId}
          className={buttonClass('primary')}
          onClick={() =>
            setModal({
              title: `${ac.add}: ${ac.tabs.sections} (${mediumLabel(medium)})`,
              fields,
              initial: { class_id: '', name: '', capacity: '' },
              save: save(),
            })
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
          {ac.add}
        </button>
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <select aria-label={ac.fields.year} value={yearId} onChange={(e) => setYearId(e.target.value)} className={inputClass + ' sm:w-56'}>
          {years.state.status === 'ready' &&
            years.state.data.map((y) => (
              <option key={y.id} value={y.id}>
                {pick(y.name_en, y.name_bn)}
              </option>
            ))}
        </select>
        <select aria-label={ac.fields.medium} value={medium} onChange={(e) => setMedium(e.target.value as Medium)} className={inputClass + ' sm:w-56'}>
          {MEDIUMS.map((m) => (
            <option key={m} value={m}>
              {mediumLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <QueryView state={sections.state} retry={sections.retry} empty={t.admin.common.noRecords}>
        {() => (
          <div className="-mx-5 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className={th}>{ac.fields.class}</th>
                  <th className={th}>{ac.fields.section_name}</th>
                  <th className={th}>{ac.fields.capacity}</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className={cx(td, 'font-medium text-navy-900')}>{s.class ? pick(s.class.name_en, s.class.name_bn) : '—'}</td>
                    <td className={td}>{s.name}</td>
                    <td className={cx(td, 'text-slate-600')}>{s.capacity ?? '—'}</td>
                    <td className={td}>
                      <RowActions
                        label={`${s.class?.name_en ?? ''} ${s.name}`}
                        onEdit={() =>
                          setModal({
                            title: `${t.admin.common.edit}: ${s.class?.name_en ?? ''} ${s.name}`,
                            fields,
                            initial: { class_id: s.class_id, name: s.name, capacity: s.capacity == null ? '' : String(s.capacity) },
                            save: save(s.id),
                          })
                        }
                        onDelete={() =>
                          setToDelete({
                            label: `${s.class?.name_en ?? ''} ${s.name}`,
                            run: async () => {
                              const { error } = await supabase!.from('sections').delete().eq('id', s.id);
                              return error ? msg(error.code) : null;
                            },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      {ui}
    </Panel>
  );
}

// ---------- Subjects --------------------------------------------------------
function SubjectsTab() {
  const { t, pick } = useLang();
  const ac = t.admin.academics;
  const msg = useMessages();
  const [reload, setReload] = useState(0);
  const { ui, setModal, setToDelete } = useEditors(() => setReload((n) => n + 1));
  const { state, retry } = useQuery<Subject[]>((db) => db.from('subjects').select('*').order('name_en'), [reload]);

  const fields: EntityField[] = [
    { name: 'code', label: ac.fields.code, type: 'text', required: true, pattern: CODE_RE, hint: ac.codeHint, maxLength: 30 },
    { name: 'is_active', label: ac.fields.is_active, type: 'checkbox' },
    { name: 'name_en', label: ac.fields.name_en, type: 'text', required: true, maxLength: 120 },
    { name: 'name_bn', label: ac.fields.name_bn, type: 'text', maxLength: 120, lang: 'bn' },
  ];
  const save = (id?: string) => async (v: EntityValues) => {
    const payload = toEntityPayload(fields, v);
    const { error } = id
      ? await supabase!.from('subjects').update(payload).eq('id', id)
      : await supabase!.from('subjects').insert(payload);
    return error ? msg(error.code) : null;
  };

  return (
    <Panel
      title={ac.tabs.subjects}
      actions={
        <button
          type="button"
          className={buttonClass('primary')}
          onClick={() =>
            setModal({ title: `${ac.add}: ${ac.tabs.subjects}`, fields, initial: { code: '', name_en: '', name_bn: '', is_active: true }, save: save() })
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
          {ac.add}
        </button>
      }
    >
      <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
        {(rows) => (
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => (
              <li key={s.id} className={cx('flex items-center justify-between gap-3 py-2.5', !s.is_active && 'opacity-50')}>
                <span>
                  <span className="font-medium text-navy-900">{pick(s.name_en, s.name_bn)}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">{s.code}</span>
                </span>
                <RowActions
                  label={s.name_en}
                  onEdit={() =>
                    setModal({
                      title: `${t.admin.common.edit}: ${s.name_en}`,
                      fields,
                      initial: { code: s.code, name_en: s.name_en, name_bn: s.name_bn ?? '', is_active: s.is_active },
                      save: save(s.id),
                    })
                  }
                  onDelete={() =>
                    setToDelete({
                      label: s.name_en,
                      run: async () => {
                        const { error } = await supabase!.from('subjects').delete().eq('id', s.id);
                        return error ? msg(error.code) : null;
                      },
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      {ui}
    </Panel>
  );
}

// ---------- Curriculum (class subjects per stream) --------------------------
interface ClassSubjectRow {
  id: string;
  subject_id: string;
  is_optional: boolean;
}

function CurriculumTab() {
  const { t, pick } = useLang();
  const ac = t.admin.academics;
  const msg = useMessages();
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const [classId, setClassId] = useState('');
  const [medium, setMedium] = useState<Medium>('bangla_medium');
  const [selected, setSelected] = useState<Record<string, { optional: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  const classes = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('*,class_streams(class_id,medium,admission_open)').order('level'),
    [],
  );
  const subjects = useQuery<Subject[]>((db) => db.from('subjects').select('*').eq('is_active', true).order('name_en'), []);
  const current = useQuery<ClassSubjectRow[]>(
    (db) =>
      db
        .from('class_subjects')
        .select('id,subject_id,is_optional')
        .eq('class_id', classId || '00000000-0000-0000-0000-000000000000')
        .eq('medium', medium),
    [classId, medium, reload],
  );

  useEffect(() => {
    if (current.state.status === 'ready') {
      setSelected(Object.fromEntries(current.state.data.map((r) => [r.subject_id, { optional: r.is_optional }])));
    }
  }, [current.state]);

  const cls = classes.state.status === 'ready' ? classes.state.data.find((c) => c.id === classId) : undefined;
  const offered = Boolean(cls?.class_streams.some((s) => s.medium === medium));

  const save = async () => {
    if (!supabase || current.state.status !== 'ready') return;
    const existing = new Map(current.state.data.map((r) => [r.subject_id, r]));
    const toDelete = current.state.data.filter((r) => !selected[r.subject_id]).map((r) => r.id);
    const toUpsert = Object.entries(selected)
      .filter(([sid, v]) => !existing.has(sid) || existing.get(sid)!.is_optional !== v.optional)
      .map(([sid, v], i) => ({ class_id: classId, medium, subject_id: sid, is_optional: v.optional, sort_order: i }));
    setSaving(true);
    let error = null;
    if (toDelete.length) ({ error } = await supabase.from('class_subjects').delete().in('id', toDelete));
    if (!error && toUpsert.length) {
      ({ error } = await supabase.from('class_subjects').upsert(toUpsert, { onConflict: 'class_id,medium,subject_id' }));
    }
    setSaving(false);
    if (error) toast('error', msg(error.code));
    else toast('success', t.admin.common.saved);
    setReload((n) => n + 1);
  };

  return (
    <Panel title={ac.tabs.curriculum}>
      <p className="mb-4 text-sm text-slate-600">{ac.curriculumHelp}</p>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <select aria-label={ac.fields.class} value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass + ' sm:w-64'}>
          <option value="">{ac.selectClass}</option>
          {classes.state.status === 'ready' &&
            classes.state.data.map((c) => (
              <option key={c.id} value={c.id}>
                {pick(c.name_en, c.name_bn)}
              </option>
            ))}
        </select>
        <select aria-label={ac.fields.medium} value={medium} onChange={(e) => setMedium(e.target.value as Medium)} className={inputClass + ' sm:w-56'}>
          {MEDIUMS.map((m) => (
            <option key={m} value={m}>
              {mediumLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {classId && !offered && <InlineNotice tone="warning">{ac.notOffered}</InlineNotice>}

      {classId && offered && (
        <QueryView state={subjects.state} retry={subjects.retry} empty={t.admin.common.noRecords}>
          {(list) => (
            <>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((s) => {
                  const on = Boolean(selected[s.id]);
                  return (
                    <li key={s.id} className={cx('flex items-center justify-between gap-3 rounded-lg border px-3 py-2', on ? 'border-royal-200 bg-royal-50/50' : 'border-slate-200')}>
                      <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-navy-900">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            setSelected((x) => {
                              const next = { ...x };
                              if (e.target.checked) next[s.id] = { optional: false };
                              else delete next[s.id];
                              return next;
                            })
                          }
                          className="h-4 w-4 rounded border-navy-300 text-royal-600"
                        />
                        <span className="truncate">{pick(s.name_en, s.name_bn)}</span>
                      </label>
                      {on && (
                        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={selected[s.id].optional}
                            onChange={(e) => setSelected((x) => ({ ...x, [s.id]: { optional: e.target.checked } }))}
                            className="h-3.5 w-3.5 rounded border-slate-300"
                          />
                          {ac.fields.optional}
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={save} disabled={saving || current.state.status !== 'ready'} className={buttonClass('primary')}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {ac.saveCurriculum}
                </button>
              </div>
            </>
          )}
        </QueryView>
      )}
    </Panel>
  );
}
