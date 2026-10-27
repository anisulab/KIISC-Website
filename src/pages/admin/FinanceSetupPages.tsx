import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Pencil, Plus, Printer } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { FINANCE_MANAGE_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { MEDIUMS, type AcademicYear, type ClassWithStreams, type Medium } from '@/lib/academics';
import { addDays, schoolToday } from '@/lib/attendance';
import { FEE_FREQUENCIES, financeError, money, type PaymentMethod } from '@/lib/finance';
import { QueryView, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, Panel, useToast } from '@/components/admin/adminUi';
import { EntityModal, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { useMediumLabel } from '@/components/admissions';

function useYears() {
  return useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
}

function useDefaultYear(years: ReturnType<typeof useYears>) {
  const [yearId, setYearId] = useState('');
  useEffect(() => {
    if (!yearId && years.state.status === 'ready' && years.state.data.length) {
      setYearId((years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id);
    }
  }, [years.state, yearId]);
  return [yearId, setYearId] as const;
}

function YearSelect({ years, value, onChange }: { years: ReturnType<typeof useYears>; value: string; onChange: (v: string) => void }) {
  const { t, pick } = useLang();
  return (
    <select aria-label={t.admin.finance.generate.year} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass + ' w-auto'}>
      {years.state.status === 'ready' &&
        years.state.data.map((y) => (
          <option key={y.id} value={y.id}>
            {pick(y.name_en, y.name_bn)}
          </option>
        ))}
    </select>
  );
}

type Tab = 'structures' | 'categories' | 'discounts';
type Modal = { kind: Tab; id?: string; initial: EntityValues } | null;

interface Category {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
}
interface Structure {
  id: string;
  class_id: string;
  medium: Medium | null;
  fee_category_id: string;
  amount: number;
  frequency: string;
  due_date: string | null;
  late_fee_amount: number;
  late_fee_after_days: number | null;
  is_active: boolean;
  class: { name_en: string; name_bn: string | null; level: number } | null;
  category: { name_en: string; name_bn: string | null } | null;
}
interface Discount {
  id: string;
  student_id: string;
  fee_category_id: string | null;
  kind: 'percent' | 'fixed';
  value: number;
  reason: string;
  is_active: boolean;
  category: { name_en: string; name_bn: string | null } | null;
}

export function FeeSetupPage() {
  const { t, lang, pick } = useLang();
  const s = t.admin.finance.setup;
  usePageMeta(s.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, FINANCE_MANAGE_ROLES);
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const years = useYears();
  const [yearId, setYearId] = useDefaultYear(years);
  const [tab, setTab] = useState<Tab>('structures');
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<Modal>(null);

  const categories = useQuery<Category[]>((db) => db.from('fee_categories').select('*').order('name_en'), [reload]);
  const classes = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('id,code,name_en,name_bn,level,is_active,class_streams(class_id,medium,admission_open)').eq('is_active', true).order('level'),
    [],
  );
  const structures = useQuery<Structure[]>(
    (db) =>
      yearId
        ? db.from('fee_structures').select('*,class:classes(name_en,name_bn,level),category:fee_categories(name_en,name_bn)').eq('academic_year_id', yearId)
        : Promise.resolve({ data: [], error: null }),
    [yearId, reload],
  );
  const discounts = useQuery<Discount[]>(
    (db) =>
      yearId
        ? db.from('student_discounts').select('*,category:fee_categories(name_en,name_bn)').eq('academic_year_id', yearId).order('approved_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    [yearId, reload],
  );
  const discountStudents = useQuery<{ id: string; student_code: string; name_en: string; name_bn: string | null }[]>(
    (db) => {
      const ids = discounts.state.status === 'ready' ? discounts.state.data.map((d) => d.student_id) : [];
      return ids.length ? db.from('finance_students').select('id,student_code,name_en,name_bn').in('id', ids) : Promise.resolve({ data: [], error: null });
    },
    [discounts.state],
  );
  const studentMap = new Map((discountStudents.state.status === 'ready' ? discountStudents.state.data : []).map((x) => [x.id, x]));

  const catOptions = (categories.state.status === 'ready' ? categories.state.data.filter((c) => c.is_active) : []).map((c) => ({ value: c.id, label: pick(c.name_en, c.name_bn) }));
  const fields: Record<Tab, EntityField[]> = {
    categories: [
      { name: 'code', label: s.fields.code, type: 'text', required: true, pattern: /^[a-z0-9-]{1,40}$/, hint: t.admin.academics.codeHint, maxLength: 40 },
      { name: 'is_active', label: s.fields.is_active, type: 'checkbox' },
      { name: 'name_en', label: s.fields.name_en, type: 'text', required: true, maxLength: 100 },
      { name: 'name_bn', label: s.fields.name_bn, type: 'text', maxLength: 100, lang: 'bn' },
    ],
    structures: [
      {
        name: 'class_id',
        label: s.fields.class,
        type: 'select',
        required: true,
        options: [{ value: '', label: t.apply.select }, ...(classes.state.status === 'ready' ? classes.state.data.map((c) => ({ value: c.id, label: pick(c.name_en, c.name_bn) })) : [])],
      },
      { name: 'medium', label: s.fields.medium, type: 'select', options: [{ value: '', label: s.fields.bothStreams }, ...MEDIUMS.map((m) => ({ value: m, label: mediumLabel(m) }))] },
      { name: 'fee_category_id', label: s.fields.category, type: 'select', required: true, options: [{ value: '', label: t.apply.select }, ...catOptions] },
      { name: 'frequency', label: s.fields.frequency, type: 'select', options: FEE_FREQUENCIES.map((f) => ({ value: f, label: s.frequencies[f] })) },
      { name: 'amount', label: s.fields.amount, type: 'number', required: true },
      { name: 'due_date', label: s.fields.due_date, type: 'date' },
      { name: 'late_fee_amount', label: s.fields.late_fee_amount, type: 'number' },
      { name: 'late_fee_after_days', label: s.fields.late_fee_after_days, type: 'number' },
      { name: 'is_active', label: s.fields.is_active, type: 'checkbox' },
    ],
    discounts: [
      { name: 'student_code', label: s.fields.student, type: 'text', required: true, maxLength: 20 },
      { name: 'fee_category_id', label: s.fields.category, type: 'select', options: [{ value: '', label: s.fields.allCategories }, ...catOptions] },
      { name: 'kind', label: s.fields.kind, type: 'select', options: (['percent', 'fixed'] as const).map((k) => ({ value: k, label: s.discountKinds[k] })) },
      { name: 'value', label: s.fields.value, type: 'number', required: true },
      { name: 'reason', label: s.fields.reason, type: 'textarea', required: true, maxLength: 300 },
    ],
  };

  const save = async (v: EntityValues): Promise<string | null> => {
    if (!modal) return null;
    const fe = t.admin.finance.errors;
    let error;
    if (modal.kind === 'categories') {
      const payload = toEntityPayload(fields.categories, v);
      ({ error } = modal.id ? await supabase!.from('fee_categories').update(payload).eq('id', modal.id) : await supabase!.from('fee_categories').insert(payload));
    } else if (modal.kind === 'structures') {
      const amount = Number(v.amount);
      const late = Number(v.late_fee_amount || 0);
      if (!(amount > 0) || late < 0 || !/^\d+(\.\d{1,2})?$/.test(String(v.amount))) return fe.INVALID_AMOUNT;
      const payload = { ...toEntityPayload(fields.structures, v), academic_year_id: yearId, late_fee_amount: late };
      ({ error } = modal.id ? await supabase!.from('fee_structures').update(payload).eq('id', modal.id) : await supabase!.from('fee_structures').insert(payload));
    } else {
      const value = Number(v.value);
      if (!(value > 0) || (v.kind === 'percent' && value > 100)) return fe.INVALID_AMOUNT;
      const { data: st } = await supabase!.from('finance_students').select('id').eq('student_code', String(v.student_code).trim().toUpperCase()).maybeSingle();
      if (!st) return s.studentNotFound;
      ({ error } = await supabase!.from('student_discounts').insert({
        student_id: st.id,
        academic_year_id: yearId,
        fee_category_id: v.fee_category_id || null,
        kind: v.kind,
        value,
        reason: String(v.reason).trim(),
      }));
    }
    if (error) return financeError(t, error);
    setModal(null);
    toast('success', t.admin.common.saved);
    setReload((n) => n + 1);
    return null;
  };

  const sortedStructures =
    structures.state.status === 'ready'
      ? [...structures.state.data].sort((a, b) => (a.class?.level ?? 0) - (b.class?.level ?? 0) || (a.category?.name_en ?? '').localeCompare(b.category?.name_en ?? ''))
      : [];
  const addLabel = { structures: s.addStructure, categories: s.addCategory, discounts: s.addDiscount }[tab];
  const blank: Record<Tab, EntityValues> = {
    categories: { code: '', name_en: '', name_bn: '', is_active: true },
    structures: { class_id: '', medium: '', fee_category_id: '', frequency: 'monthly', amount: '', due_date: '', late_fee_amount: '0', late_fee_after_days: '', is_active: true },
    discounts: { student_code: '', fee_category_id: '', kind: 'percent', value: '', reason: '' },
  };

  return (
    <>
      <AdminPageHeader
        title={s.title}
        subtitle={s.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tab !== 'categories' && <YearSelect years={years} value={yearId} onChange={setYearId} />}
            {canManage && (
              <button type="button" onClick={() => setModal({ kind: tab, initial: blank[tab] })} className={buttonClass('primary')}>
                <Plus className="h-4 w-4" aria-hidden />
                {addLabel}
              </button>
            )}
          </div>
        }
      />
      <div role="tablist" className="mb-6 inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {(['structures', 'categories', 'discounts'] as Tab[]).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx('rounded-lg px-4 py-2 text-sm font-semibold', tab === k ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}
          >
            {s[k]}
          </button>
        ))}
      </div>

      {tab === 'structures' && (
        <Panel>
          <QueryView state={structures.state} retry={structures.retry} empty={t.admin.common.noRecords}>
            {() => (
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{s.fields.class}</th>
                      <th className="px-3 py-2 font-semibold">{s.fields.category}</th>
                      <th className="px-3 py-2 font-semibold">{s.fields.frequency}</th>
                      <th className="px-3 py-2 text-right font-semibold">{s.fields.amount}</th>
                      <th className="px-3 py-2 text-right font-semibold">{s.fields.late_fee_amount}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedStructures.map((f) => (
                      <tr key={f.id} className={cx(!f.is_active && 'opacity-50')}>
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-navy-900">{f.class ? pick(f.class.name_en, f.class.name_bn) : ''}</span>
                          <span className="block text-xs text-slate-500">{f.medium ? mediumLabel(f.medium) : s.fields.bothStreams}</span>
                        </td>
                        <td className="px-3 py-2.5">{f.category ? pick(f.category.name_en, f.category.name_bn) : ''}</td>
                        <td className="px-3 py-2.5 text-slate-600">{s.frequencies[f.frequency]}</td>
                        <td className="px-3 py-2.5 text-right font-semibold">{money(f.amount, lang)}</td>
                        <td className="px-3 py-2.5 text-right text-slate-600">{Number(f.late_fee_amount) > 0 ? money(f.late_fee_amount, lang) : '—'}</td>
                        <td className="px-3 py-2.5 text-right">
                          {canManage && (
                            <button
                              type="button"
                              className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700"
                              aria-label={t.admin.common.edit}
                              onClick={() =>
                                setModal({
                                  kind: 'structures',
                                  id: f.id,
                                  initial: {
                                    class_id: f.class_id,
                                    medium: f.medium ?? '',
                                    fee_category_id: f.fee_category_id,
                                    frequency: f.frequency,
                                    amount: String(f.amount),
                                    due_date: f.due_date ?? '',
                                    late_fee_amount: String(f.late_fee_amount),
                                    late_fee_after_days: f.late_fee_after_days == null ? '' : String(f.late_fee_after_days),
                                    is_active: f.is_active,
                                  },
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryView>
        </Panel>
      )}

      {tab === 'categories' && (
        <Panel>
          <QueryView state={categories.state} retry={categories.retry} empty={t.admin.common.noRecords}>
            {(rows) => (
              <ul className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <li key={c.id} className={cx('flex items-center justify-between gap-3 py-2.5', !c.is_active && 'opacity-50')}>
                    <span>
                      <span className="font-medium text-navy-900">{pick(c.name_en, c.name_bn)}</span>
                      <span className="ml-2 font-mono text-xs text-slate-400">{c.code}</span>
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700"
                        aria-label={t.admin.common.edit}
                        onClick={() => setModal({ kind: 'categories', id: c.id, initial: { code: c.code, name_en: c.name_en, name_bn: c.name_bn ?? '', is_active: c.is_active } })}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </Panel>
      )}

      {tab === 'discounts' && (
        <Panel>
          <QueryView state={discounts.state} retry={discounts.retry} empty={t.admin.common.noRecords}>
            {(rows) => (
              <ul className="divide-y divide-slate-100">
                {rows.map((d) => {
                  const st = studentMap.get(d.student_id);
                  return (
                    <li key={d.id} className={cx('flex flex-wrap items-center justify-between gap-3 py-3', !d.is_active && 'opacity-50')}>
                      <div className="text-sm">
                        <p className="font-medium text-navy-900">
                          {st ? pick(st.name_en, st.name_bn) : '…'} <span className="font-mono text-xs text-slate-400">{st?.student_code}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {d.category ? pick(d.category.name_en, d.category.name_bn) : s.fields.allCategories} · {d.reason}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-emerald-700">{d.kind === 'percent' ? `${d.value}%` : money(d.value, lang)}</span>
                        {!d.is_active ? (
                          <span className="text-xs text-slate-500">{s.inactive}</span>
                        ) : (
                          canManage && (
                            <button
                              type="button"
                              className={buttonClass('ghost', 'px-2 py-1 text-xs text-red-700')}
                              onClick={async () => {
                                const { error } = await supabase!.from('student_discounts').update({ is_active: false }).eq('id', d.id);
                                if (error) toast('error', financeError(t, error));
                                else setReload((n) => n + 1);
                              }}
                            >
                              {s.deactivate}
                            </button>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </QueryView>
        </Panel>
      )}

      <EntityModal open={modal !== null} title={addLabel} fields={modal ? fields[modal.kind] : []} initial={modal?.initial ?? {}} onClose={() => setModal(null)} onSubmit={save} />
    </>
  );
}

// ====================================================================
interface CollectionRow {
  paid_on: string;
  method: PaymentMethod;
  payments: number;
  amount: number;
}
interface OutstandingRow {
  student_id: string;
  student_code: string;
  name_en: string;
  name_bn: string | null;
  class_name_en: string | null;
  class_name_bn: string | null;
  section_name: string | null;
  invoiced: number;
  paid: number;
  balance: number;
  oldest_due: string | null;
}

export function FinanceReportsPage() {
  const { t, lang, pick, formatDate } = useLang();
  const f = t.admin.finance;
  const r = f.reports;
  usePageMeta(r.title, undefined, { noindex: true });
  const [tab, setTab] = useState<'collections' | 'outstanding'>('collections');
  const [from, setFrom] = useState(addDays(schoolToday(), -30));
  const [to, setTo] = useState(schoolToday());
  const years = useYears();
  const [yearId, setYearId] = useDefaultYear(years);
  const [classId, setClassId] = useState('');
  const { me } = useAuth();
  const canManage = hasAnyRole(me, FINANCE_MANAGE_ROLES);
  const toast = useToast();
  const [remindOpen, setRemindOpen] = useState(false);
  const [reminding, setReminding] = useState(false);
  const classes = useQuery<{ id: string; name_en: string; name_bn: string | null }[]>((db) => db.from('classes').select('id,name_en,name_bn').order('level'), []);
  const collections = useQuery<CollectionRow[]>((db) => db.rpc('finance_collections', { p_from: from, p_to: to }), [from, to]);
  const outstanding = useQuery<OutstandingRow[]>(
    (db) => (yearId ? db.rpc('finance_outstanding', { p_year: yearId, p_class: classId || null }) : Promise.resolve({ data: [], error: null })),
    [yearId, classId],
  );

  const colRows = collections.state.status === 'ready' ? collections.state.data : [];
  const byMethod = new Map<string, number>();
  for (const c of colRows) byMethod.set(c.method, (byMethod.get(c.method) ?? 0) + Number(c.amount));
  const grand = colRows.reduce((s, c) => s + Number(c.amount), 0);

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
        {(['collections', 'outstanding'] as const).map((k) => (
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

      {tab === 'collections' ? (
        <Panel>
          <div className="no-print mb-5 grid gap-3 sm:grid-cols-2 md:w-1/2">
            <label className="text-sm font-semibold text-navy-800">
              {f.payment.from}
              <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className={inputClass + ' mt-1.5'} />
            </label>
            <label className="text-sm font-semibold text-navy-800">
              {f.payment.to}
              <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className={inputClass + ' mt-1.5'} />
            </label>
          </div>
          <QueryView state={collections.state} retry={collections.retry} empty={r.empty}>
            {(rows) => (
              <>
                <ul className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <li className="rounded-xl bg-navy-900 p-4 text-white">
                    <p className="text-xs text-navy-200">{r.total}</p>
                    <p className="text-xl font-bold">{money(grand, lang)}</p>
                  </li>
                  {[...byMethod.entries()].map(([m, amount]) => (
                    <li key={m} className="rounded-xl border border-slate-200 p-4">
                      <p className="text-xs text-slate-500">{f.methods[m]}</p>
                      <p className="text-lg font-bold text-navy-900">{money(amount, lang)}</p>
                    </li>
                  ))}
                </ul>
                <div className="-mx-5 overflow-x-auto sm:mx-0">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">{f.columns.date}</th>
                        <th className="px-3 py-2 font-semibold">{f.columns.method}</th>
                        <th className="px-3 py-2 text-right font-semibold">{r.payments}</th>
                        <th className="px-3 py-2 text-right font-semibold">{f.columns.amount}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((c) => (
                        <tr key={c.paid_on + c.method}>
                          <td className="px-3 py-2">{formatDate(c.paid_on + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                          <td className="px-3 py-2">{f.methods[c.method]}</td>
                          <td className="px-3 py-2 text-right">{c.payments}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(c.amount, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </QueryView>
        </Panel>
      ) : (
        <Panel>
          <div className="no-print mb-5 flex flex-wrap gap-3">
            <YearSelect years={years} value={yearId} onChange={setYearId} />
            <select aria-label={f.generate.class} value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass + ' w-auto'}>
              <option value="">{r.allClasses}</option>
              {classes.state.status === 'ready' &&
                classes.state.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(c.name_en, c.name_bn)}
                  </option>
                ))}
            </select>
            {canManage && (
              <button type="button" disabled={!yearId} onClick={() => setRemindOpen(true)} className={buttonClass('outline', 'sm:ml-auto')}>
                <Mail className="h-4 w-4" aria-hidden />
                {r.sendReminders}
              </button>
            )}
          </div>
          <ConfirmDialog
            open={remindOpen}
            danger={false}
            busy={reminding}
            title={r.remindersTitle}
            body={r.remindersBody}
            confirmLabel={r.sendReminders}
            onCancel={() => setRemindOpen(false)}
            onConfirm={async () => {
              if (!supabase) return;
              setReminding(true);
              const { data, error } = await supabase.rpc('queue_fee_reminders', { p_year: yearId, p_class: classId || null });
              setReminding(false);
              setRemindOpen(false);
              if (error) return toast('error', error.message === 'NOTIFICATIONS_DISABLED' ? r.remindersDisabled : financeError(t, error));
              toast('success', r.remindersQueued(Number(data ?? 0)));
            }}
          />
          <QueryView state={outstanding.state} retry={outstanding.retry} empty={r.empty}>
            {(rows) => (
              <>
                <p className="mb-3 text-sm font-semibold text-navy-900">
                  {r.total}: <span className="text-red-700">{money(rows.reduce((s, x) => s + Number(x.balance), 0), lang)}</span>
                </p>
                <div className="-mx-5 overflow-x-auto sm:mx-0">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">{f.columns.student}</th>
                        <th className="px-3 py-2 text-right font-semibold">{r.invoiced}</th>
                        <th className="px-3 py-2 text-right font-semibold">{f.columns.paid}</th>
                        <th className="px-3 py-2 text-right font-semibold">{f.columns.balance}</th>
                        <th className="px-3 py-2 font-semibold">{r.oldestDue}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((o) => (
                        <tr key={o.student_id}>
                          <td className="px-3 py-2">
                            <Link to={`/admin/finance/invoices?q=${o.student_code}`} className="font-medium text-navy-900 hover:text-royal-700">
                              {pick(o.name_en, o.name_bn)}
                            </Link>
                            <span className="block font-mono text-xs text-slate-400">
                              {o.student_code}
                              {o.class_name_en && ` · ${pick(o.class_name_en, o.class_name_bn)}${o.section_name ? ` ${o.section_name}` : ''}`}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{money(o.invoiced, lang)}</td>
                          <td className="px-3 py-2 text-right">{money(o.paid, lang)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-red-700">{money(o.balance, lang)}</td>
                          <td className="px-3 py-2 text-slate-600">{o.oldest_due ? formatDate(o.oldest_due + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </QueryView>
        </Panel>
      )}
    </>
  );
}
