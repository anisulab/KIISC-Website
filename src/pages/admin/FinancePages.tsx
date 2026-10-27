import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, FilePlus2, Loader2, Plus, Printer, Receipt, Search, Undo2, Wallet } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useInstitution } from '@/hooks/useInstitution';
import { useAuth } from '@/auth/AuthProvider';
import { FINANCE_MANAGE_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeSearch } from '@/lib/content';
import { MEDIUMS, type AcademicYear, type ClassWithStreams, type Medium } from '@/lib/academics';
import { addDays, schoolToday } from '@/lib/attendance';
import {
  INVOICE_STATE_TONES,
  PAYMENT_METHODS,
  financeError,
  invoiceState,
  money,
  validAmount,
  type FinanceStudent,
  type InvoiceSummary,
  type Payment,
  type PaymentMethod,
} from '@/lib/finance';
import { Logo, Pagination, QueryView, Spinner, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, InlineNotice, Modal, Panel, SelectField, TextAreaField, TextField, useToast } from '@/components/admin/adminUi';
import { useMediumLabel } from '@/components/admissions';
import { useActorNames } from './AuditPage';

const PAGE_SIZE = 25;

export function InvoiceStateBadge({ invoice }: { invoice: Pick<InvoiceSummary, 'status' | 'paid' | 'balance'> }) {
  const { t } = useLang();
  const s = invoiceState(invoice);
  return <span className={cx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', INVOICE_STATE_TONES[s])}>{t.admin.finance.invoiceStatus[s]}</span>;
}

/** Looks up minimal student details (finance directory) for a set of ids. */
function useFinanceStudents(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const q = useQuery<FinanceStudent[]>(
    (db) => (key ? db.from('finance_students').select('*').in('id', key.split(',')) : Promise.resolve({ data: [], error: null })),
    [key],
  );
  return useMemo(() => new Map((q.state.status === 'ready' ? q.state.data : []).map((s) => [s.id, s])), [q.state]);
}

function useYears() {
  return useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
}

function StudentCell({ s }: { s?: FinanceStudent }) {
  const { pick } = useLang();
  if (!s) return <span className="text-slate-400">…</span>;
  return (
    <>
      <span className="font-medium text-navy-900">{pick(s.name_en, s.name_bn)}</span>
      <span className="block font-mono text-xs text-slate-400">
        {s.student_code}
        {s.class_name_en && ` · ${pick(s.class_name_en, s.class_name_bn)}${s.section_name ? ` ${s.section_name}` : ''}`}
      </span>
    </>
  );
}

/** Compact fee summary for a student profile (finance viewers only). */
export function StudentFeesPanel({ studentId }: { studentId: string }) {
  const { t, lang, pick } = useLang();
  const f = t.admin.finance;
  const { state, retry } = useQuery<InvoiceSummary[]>(
    (db) => db.from('invoice_summaries').select('*').eq('student_id', studentId).order('due_date', { ascending: false }).limit(12),
    [studentId],
  );
  const open = state.status === 'ready' ? state.data.filter((i) => i.status === 'issued') : [];
  const balance = open.reduce((s, i) => s + Number(i.balance), 0);
  return (
    <Panel title={f.studentPanel} actions={<span className={cx('text-sm font-bold', balance > 0 ? 'text-red-700' : 'text-emerald-700')}>{money(balance, lang)}</span>}>
      <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
        {(rows) => (
          <ul className="divide-y divide-slate-100 text-sm">
            {rows.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/admin/finance/invoices/${i.id}`} className="min-w-0 truncate text-navy-900 hover:text-royal-700">
                  {pick(i.title_en, i.title_bn)}
                </Link>
                <InvoiceStateBadge invoice={i} />
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

// ====================================================================
// Invoices
// ====================================================================
export function InvoicesPage() {
  const { t, lang, pick, formatDate } = useLang();
  const f = t.admin.finance;
  usePageMeta(f.invoicesTitle, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, FINANCE_MANAGE_ROLES);
  const [params, setParams] = useSearchParams();
  const years = useYears();
  const yearList = years.state.status === 'ready' ? years.state.data : [];
  const year = params.get('year') || (yearList.find((y) => y.is_current) ?? yearList[0])?.id || '';
  const state = params.get('state') ?? '';
  const q = sanitizeSearch(params.get('q') ?? '');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draftQ, setDraftQ] = useState(q);

  const matches = useQuery<{ id: string }[]>(
    (db) => (q ? db.from('finance_students').select('id').or(`name_en.ilike.*${q}*,name_bn.ilike.*${q}*,student_code.ilike.*${q}*`).limit(200) : Promise.resolve({ data: [], error: null })),
    [q],
  );
  const matchIds = matches.state.status === 'ready' ? matches.state.data.map((m) => m.id) : [];

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const { state: list, retry } = useQuery<InvoiceSummary[]>(
    (db) => {
      if (!year || (q && matches.state.status !== 'ready')) return Promise.resolve({ data: [], error: null, count: 0 });
      let query = db.from('invoice_summaries').select('*', { count: 'exact' }).eq('academic_year_id', year);
      if (q) query = query.in('student_id', matchIds.length ? matchIds : ['00000000-0000-0000-0000-000000000000']);
      if (state === 'cancelled') query = query.eq('status', 'cancelled');
      if (state === 'paid') query = query.eq('status', 'issued').lte('balance', 0);
      if (state === 'partial') query = query.eq('status', 'issued').gt('paid', 0).gt('balance', 0);
      if (state === 'unpaid') query = query.eq('status', 'issued').eq('paid', 0);
      const from = (page - 1) * PAGE_SIZE;
      return query.order('due_date', { ascending: false }).order('invoice_no', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    },
    [year, state, q, page, matchIds.join(',')],
  );
  const students = useFinanceStudents(list.status === 'ready' ? list.data.map((i) => i.student_id) : []);

  return (
    <>
      <AdminPageHeader
        title={f.invoicesTitle}
        subtitle={f.invoicesSubtitle}
        actions={
          canManage ? (
            <Link to="/admin/finance/generate" className={buttonClass('primary')}>
              <FilePlus2 className="h-4 w-4" aria-hidden />
              {t.admin.menu.billing}
            </Link>
          ) : undefined
        }
      />
      <Panel>
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <form
            role="search"
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: sanitizeSearch(draftQ) || null, page: null });
            }}
          >
            <label htmlFor="inv-search" className="sr-only">
              {t.common.search}
            </label>
            <input id="inv-search" type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder={f.searchStudent} className={inputClass} maxLength={80} />
            <button type="submit" className={buttonClass('outline', 'px-3')} aria-label={t.common.search}>
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <select aria-label={f.generate.year} value={year} onChange={(e) => set({ year: e.target.value, page: null })} className={inputClass + ' md:w-52'}>
            {yearList.map((y) => (
              <option key={y.id} value={y.id}>
                {pick(y.name_en, y.name_bn)}
              </option>
            ))}
          </select>
          <select aria-label={f.columns.status} value={state} onChange={(e) => set({ state: e.target.value || null, page: null })} className={inputClass + ' md:w-48'}>
            <option value="">{f.allInvoices}</option>
            {(['unpaid', 'partial', 'paid', 'cancelled'] as const).map((s) => (
              <option key={s} value={s}>
                {f.invoiceStatus[s]}
              </option>
            ))}
          </select>
        </div>
        <QueryView state={list} retry={retry} empty={t.admin.common.noRecords}>
          {(rows, count) => (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{f.columns.invoice}</th>
                      <th className="px-3 py-2 font-semibold">{f.columns.student}</th>
                      <th className="px-3 py-2 font-semibold">{f.columns.title}</th>
                      <th className="px-3 py-2 font-semibold">{f.columns.due}</th>
                      <th className="px-3 py-2 text-right font-semibold">{f.columns.total}</th>
                      <th className="px-3 py-2 text-right font-semibold">{f.columns.balance}</th>
                      <th className="px-3 py-2 font-semibold">{f.columns.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((i) => (
                      <tr key={i.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                          <Link to={`/admin/finance/invoices/${i.id}`} className="font-semibold text-royal-700 hover:underline">
                            {i.invoice_no}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <StudentCell s={students.get(i.student_id)} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{pick(i.title_en, i.title_bn)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDate(i.due_date + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">{money(i.total, lang)}</td>
                        <td className={cx('whitespace-nowrap px-3 py-2.5 text-right font-semibold', i.status === 'issued' && i.balance > 0 ? 'text-red-700' : 'text-navy-900')}>
                          {money(i.status === 'cancelled' ? 0 : i.balance, lang)}
                        </td>
                        <td className="px-3 py-2.5">
                          <InvoiceStateBadge invoice={i} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)} onChange={(p) => set({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

// ====================================================================
interface InvoiceItem {
  id: string;
  kind: 'charge' | 'discount' | 'late_fee' | 'adjustment';
  description_en: string;
  description_bn: string | null;
  amount: number;
  reason: string | null;
  cancelled: boolean;
}
interface Allocation {
  amount: number;
  payment: Pick<Payment, 'id' | 'receipt_no' | 'paid_on' | 'method' | 'status'> | null;
}

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const { t, lang, pick, formatDate } = useLang();
  const f = t.admin.finance;
  usePageMeta(f.invoice.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, FINANCE_MANAGE_ROLES);
  const inst = useInstitution();
  const toast = useToast();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const inv = useQuery<InvoiceSummary | null>((db) => db.from('invoice_summaries').select('*').eq('id', id).maybeSingle(), [id, reload]);
  const items = useQuery<InvoiceItem[]>((db) => db.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'), [id, reload]);
  const allocations = useQuery<Allocation[]>(
    (db) => db.from('payment_allocations').select('amount,payment:payments(id,receipt_no,paid_on,method,status)').eq('invoice_id', id),
    [id, reload],
  );
  const invoice = inv.state.status === 'ready' ? inv.state.data : null;
  const students = useFinanceStudents(invoice ? [invoice.student_id] : []);
  const student = invoice ? students.get(invoice.student_id) : undefined;
  const open = invoice?.status === 'issued';

  return (
    <>
      <Link to="/admin/finance/invoices" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <QueryView state={inv.state} retry={inv.retry} empty={t.admin.common.noRecords} isEmpty={(d) => d === null}>
        {(i) =>
          i && (
            <>
              {canManage && open && (
                <div className="no-print mb-4 flex flex-wrap gap-2">
                  {i.balance > 0 && (
                    <button type="button" onClick={() => setPaying(true)} className={buttonClass('gold')}>
                      <Wallet className="h-4 w-4" aria-hidden />
                      {f.invoice.recordPayment}
                    </button>
                  )}
                  <button type="button" onClick={() => setAdjusting(true)} className={buttonClass('outline')}>
                    <Plus className="h-4 w-4" aria-hidden />
                    {f.invoice.addAdjustment}
                  </button>
                  {i.paid <= 0 && (
                    <button type="button" onClick={() => setCancelling(true)} className={buttonClass('outline', 'text-red-700')}>
                      <Ban className="h-4 w-4" aria-hidden />
                      {f.invoice.cancel}
                    </button>
                  )}
                  <button type="button" onClick={() => window.print()} className={buttonClass('outline')}>
                    <Printer className="h-4 w-4" aria-hidden />
                    {t.admin.attendance.print}
                  </button>
                </div>
              )}
              <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none sm:p-10">
                <header className="flex items-start justify-between gap-4 border-b-2 border-navy-900 pb-4">
                  <div className="flex items-center gap-3">
                    <Logo className="h-14 w-14 shrink-0" />
                    <div>
                      <p className="heading text-lg font-bold text-navy-900">{pick(inst.name_en, inst.name_bn)}</p>
                      <p className="text-xs text-slate-600">{pick(inst.address_en, inst.address_bn)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold uppercase tracking-wide text-royal-700">{f.invoice.title}</p>
                    <p className="font-mono text-sm font-bold text-navy-900">{i.invoice_no}</p>
                    <div className="mt-1">
                      <InvoiceStateBadge invoice={i} />
                    </div>
                  </div>
                </header>
                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">{f.columns.student}</dt>
                    <dd>
                      <StudentCell s={student} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{f.invoice.issued}</dt>
                    <dd className="font-semibold text-navy-900">{formatDate(i.issue_date + 'T00:00:00')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{f.invoice.due}</dt>
                    <dd className="font-semibold text-navy-900">{formatDate(i.due_date + 'T00:00:00')}</dd>
                  </div>
                </dl>
                <p className="mt-4 font-semibold text-navy-900">{pick(i.title_en, i.title_bn)}</p>
                {i.status === 'cancelled' && i.cancel_reason && <p className="mt-1 text-sm text-red-700">{i.cancel_reason}</p>}

                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr className="bg-navy-900 text-left text-xs uppercase tracking-wide text-white">
                      <th className="px-3 py-2">{f.invoice.items}</th>
                      <th className="px-3 py-2 text-right">{f.columns.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.state.status === 'ready' &&
                      items.state.data.map((it) => (
                        <tr key={it.id} className={cx('border-b border-slate-200', it.cancelled && 'text-slate-400 line-through')}>
                          <td className="px-3 py-2">
                            {pick(it.description_en, it.description_bn)}
                            {it.kind !== 'charge' && <span className="ml-2 text-xs text-slate-500">({f.kinds[it.kind]})</span>}
                            {it.reason && <span className="block text-xs text-slate-500">{it.reason}</span>}
                          </td>
                          <td className={cx('px-3 py-2 text-right', it.amount < 0 && 'text-emerald-700')}>{money(it.amount, lang)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot className="font-semibold">
                    <tr>
                      <td className="px-3 py-2 text-right">{f.columns.total}</td>
                      <td className="px-3 py-2 text-right">{money(i.total, lang)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1 text-right text-slate-600">{f.columns.paid}</td>
                      <td className="px-3 py-1 text-right text-slate-600">{money(i.paid, lang)}</td>
                    </tr>
                    <tr className="text-lg">
                      <td className="px-3 py-2 text-right">{f.columns.balance}</td>
                      <td className={cx('px-3 py-2 text-right', i.balance > 0 && open ? 'text-red-700' : 'text-navy-900')}>{money(open ? i.balance : 0, lang)}</td>
                    </tr>
                  </tfoot>
                </table>

                <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">{f.invoice.payments}</h3>
                {allocations.state.status === 'ready' && allocations.state.data.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">{f.invoice.noPayments}</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100 text-sm">
                    {allocations.state.status === 'ready' &&
                      allocations.state.data.map((a) =>
                        a.payment ? (
                          <li key={a.payment.id} className={cx('flex flex-wrap justify-between gap-2 py-2', a.payment.status === 'reversed' && 'text-slate-400 line-through')}>
                            <Link to={`/admin/finance/receipts/${a.payment.id}`} className="font-mono text-royal-700 hover:underline">
                              {a.payment.receipt_no}
                            </Link>
                            <span>
                              {formatDate(a.payment.paid_on + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })} · {f.methods[a.payment.method]}
                              {a.payment.status === 'reversed' && ` · ${f.invoice.reversed}`}
                            </span>
                            <span className="font-semibold">{money(a.amount, lang)}</span>
                          </li>
                        ) : null,
                      )}
                  </ul>
                )}
              </article>

              <RecordPaymentModal
                open={paying}
                studentId={i.student_id}
                invoiceId={i.id}
                onClose={() => setPaying(false)}
                onDone={(paymentId) => {
                  setPaying(false);
                  navigate(`/admin/finance/receipts/${paymentId}`);
                }}
              />
              <ReasonModal
                open={adjusting}
                title={f.invoice.addAdjustment}
                withAmount
                hint={f.invoice.adjustmentHint}
                onClose={() => setAdjusting(false)}
                onSubmit={async (reason, amount) => {
                  const { error } = await supabase!.rpc('add_invoice_adjustment', { p_invoice: i.id, p_amount: amount, p_reason: reason });
                  if (error) return financeError(t, error);
                  setAdjusting(false);
                  toast('success', t.admin.common.saved);
                  setReload((n) => n + 1);
                  return null;
                }}
              />
              <ReasonModal
                open={cancelling}
                title={f.invoice.cancelTitle}
                hint={f.invoice.cancelHelp}
                danger
                onClose={() => setCancelling(false)}
                onSubmit={async (reason) => {
                  const { error } = await supabase!.rpc('cancel_invoice', { p_invoice: i.id, p_reason: reason });
                  if (error) return financeError(t, error);
                  setCancelling(false);
                  toast('success', f.invoice.cancelled);
                  setReload((n) => n + 1);
                  return null;
                }}
              />
            </>
          )
        }
      </QueryView>
    </>
  );
}

/** Small dialog collecting a required reason (and optionally a signed amount). */
function ReasonModal({
  open,
  title,
  hint,
  withAmount = false,
  danger = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  hint?: string;
  withAmount?: boolean;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (reason: string, amount: number) => Promise<string | null>;
}) {
  const { t } = useLang();
  const f = t.admin.finance;
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setAmount('');
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (withAmount && !validAmount(amount, true)) return setError(f.errors.INVALID_AMOUNT);
    if (reason.trim().length < 3) return setError(f.errors.REASON_REQUIRED);
    setBusy(true);
    const err = await onSubmit(reason.trim(), Number(amount));
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {hint && <InlineNotice tone={danger ? 'warning' : 'info'}>{hint}</InlineNotice>}
        {withAmount && <TextField label={f.invoice.amount} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />}
        <TextAreaField label={f.invoice.reason} required rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={buttonClass('outline')}>
            {t.admin.common.cancel}
          </button>
          <button type="submit" disabled={busy} className={cx(buttonClass('primary'), danger && 'bg-red-600 hover:bg-red-700')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {title}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ====================================================================
// Record payment
// ====================================================================
export function RecordPaymentModal({
  open,
  studentId: fixedStudent,
  invoiceId,
  onClose,
  onDone,
}: {
  open: boolean;
  studentId?: string;
  invoiceId?: string;
  onClose: () => void;
  onDone: (paymentId: string) => void;
}) {
  const { t, lang, pick, formatDate } = useLang();
  const f = t.admin.finance;
  const p = f.payment;
  const toast = useToast();
  const [studentId, setStudentId] = useState(fixedStudent ?? '');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(invoiceId ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(schoolToday());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per opened form: retries and double clicks return the same receipt.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setStudentId(fixedStudent ?? '');
    setSearch('');
    setTarget(invoiceId ?? '');
    setAmount('');
    setMethod('cash');
    setReference('');
    setPaidOn(schoolToday());
    setNote('');
    setError(null);
    setIdemKey(crypto.randomUUID());
  }, [open, fixedStudent, invoiceId]);

  const q = sanitizeSearch(search);
  const found = useQuery<FinanceStudent[]>(
    (db) =>
      !fixedStudent && q.length >= 2
        ? db.from('finance_students').select('*').or(`name_en.ilike.*${q}*,name_bn.ilike.*${q}*,student_code.ilike.*${q}*`).limit(8)
        : Promise.resolve({ data: [], error: null }),
    [q, fixedStudent],
  );
  const outstanding = useQuery<InvoiceSummary[]>(
    (db) =>
      studentId
        ? db.from('invoice_summaries').select('*').eq('student_id', studentId).eq('status', 'issued').gt('balance', 0).order('due_date')
        : Promise.resolve({ data: [], error: null }),
    [studentId, open],
  );
  const students = useFinanceStudents(studentId ? [studentId] : []);
  const owed = outstanding.state.status === 'ready' ? outstanding.state.data : [];
  const maxAmount = target ? owed.find((i) => i.id === target)?.balance ?? 0 : owed.reduce((s, i) => s + Number(i.balance), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!studentId) return setError(t.admin.common.required);
    if (!validAmount(amount)) return setError(f.errors.INVALID_AMOUNT);
    if (Number(amount) > Number(maxAmount)) return setError(f.errors.OVERPAYMENT);
    if ((method === 'bank' || method === 'mfs') && !reference.trim()) return setError(f.errors.REFERENCE_REQUIRED);
    setBusy(true);
    const { data, error: err } = await supabase!.rpc('record_payment', {
      p_student: studentId,
      p_amount: Number(amount),
      p_method: method,
      p_reference: reference.trim() || null,
      p_paid_on: paidOn,
      p_invoice: target || null,
      p_idempotency_key: idemKey,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(financeError(t, err));
    const r = data as { payment_id: string; receipt_no: string };
    toast('success', p.recorded(r.receipt_no));
    onDone(r.payment_id);
  };

  return (
    <Modal open={open} title={p.record} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {!fixedStudent && !studentId && (
          <div>
            <TextField label={p.findStudent} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={f.searchStudent} autoComplete="off" />
            {found.state.status === 'ready' && found.state.data.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {found.state.data.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setStudentId(s.id)} className="block w-full px-3 py-2 text-left text-sm hover:bg-royal-50">
                      <StudentCell s={s} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {studentId && (
          <>
            <div className="flex items-start justify-between gap-3 rounded-lg bg-navy-50 p-3 text-sm">
              <div>
                <StudentCell s={students.get(studentId)} />
              </div>
              {!fixedStudent && (
                <button type="button" onClick={() => setStudentId('')} className="text-xs font-semibold text-royal-700 hover:underline">
                  {t.admin.common.edit}
                </button>
              )}
            </div>
            {outstanding.state.status === 'loading' ? (
              <Spinner />
            ) : owed.length === 0 ? (
              <InlineNotice>{p.noOutstanding}</InlineNotice>
            ) : (
              <>
                <SelectField
                  label={p.applyTo}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  options={[
                    { value: '', label: `${p.oldestFirst} — ${p.outstanding} ${money(owed.reduce((s, i) => s + Number(i.balance), 0), lang)}` },
                    ...owed.map((i) => ({
                      value: i.id,
                      label: `${i.invoice_no} · ${pick(i.title_en, i.title_bn)} · ${formatDate(i.due_date + 'T00:00:00', { day: 'numeric', month: 'short' })} · ${money(i.balance, lang)}`,
                    })),
                  ]}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label={p.amount} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} hint={`≤ ${money(maxAmount, lang)}`} />
                  <TextField label={p.paidOn} required type="date" max={schoolToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  <SelectField label={p.method} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: f.methods[m] }))} />
                  <TextField
                    label={p.reference}
                    required={method === 'bank' || method === 'mfs'}
                    maxLength={100}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    hint={p.referenceHint}
                  />
                </div>
                <TextField label={p.note} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass('outline')}>
            {t.admin.common.cancel}
          </button>
          <button type="submit" disabled={busy || !studentId || owed.length === 0} className={buttonClass('gold')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {p.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ====================================================================
// Payments & receipts
// ====================================================================
export function PaymentsPage() {
  const { t, lang, formatDate } = useLang();
  const f = t.admin.finance;
  usePageMeta(f.payment.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, FINANCE_MANAGE_ROLES);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const from = params.get('from') || addDays(schoolToday(), -30);
  const to = params.get('to') || schoolToday();
  const method = (PAYMENT_METHODS as string[]).includes(params.get('method') ?? '') ? params.get('method')! : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [recording, setRecording] = useState(false);
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };
  const { state, retry } = useQuery<Payment[]>(
    (db) => {
      let query = db.from('payments').select('*', { count: 'exact' }).gte('paid_on', from).lte('paid_on', to);
      if (method) query = query.eq('method', method);
      const start = (page - 1) * PAGE_SIZE;
      return query.order('paid_on', { ascending: false }).order('received_at', { ascending: false }).range(start, start + PAGE_SIZE - 1);
    },
    [from, to, method, page],
  );
  const students = useFinanceStudents(state.status === 'ready' ? state.data.map((p) => p.student_id) : []);

  return (
    <>
      <AdminPageHeader
        title={f.payment.title}
        subtitle={f.payment.subtitle}
        actions={
          canManage ? (
            <button type="button" onClick={() => setRecording(true)} className={buttonClass('gold')}>
              <Wallet className="h-4 w-4" aria-hidden />
              {f.payment.record}
            </button>
          ) : undefined
        }
      />
      <Panel>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold text-navy-800">
            {f.payment.from}
            <input type="date" value={from} onChange={(e) => set({ from: e.target.value || null, page: null })} className={inputClass + ' mt-1.5'} />
          </label>
          <label className="text-sm font-semibold text-navy-800">
            {f.payment.to}
            <input type="date" value={to} onChange={(e) => set({ to: e.target.value || null, page: null })} className={inputClass + ' mt-1.5'} />
          </label>
          <label className="text-sm font-semibold text-navy-800">
            {f.payment.method}
            <select value={method} onChange={(e) => set({ method: e.target.value || null, page: null })} className={inputClass + ' mt-1.5'}>
              <option value="">{t.common.allTypes}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {f.methods[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
          {(rows, count) => (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{f.columns.receipt}</th>
                      <th className="px-3 py-2 font-semibold">{f.columns.date}</th>
                      <th className="px-3 py-2 font-semibold">{f.columns.student}</th>
                      <th className="px-3 py-2 font-semibold">{f.columns.method}</th>
                      <th className="px-3 py-2 text-right font-semibold">{f.columns.amount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((p) => (
                      <tr key={p.id} className={cx('hover:bg-slate-50', p.status === 'reversed' && 'text-slate-400')}>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                          <Link to={`/admin/finance/receipts/${p.id}`} className="font-semibold text-royal-700 hover:underline">
                            {p.receipt_no}
                          </Link>
                          {p.status === 'reversed' && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 font-sans text-xs text-red-700">{f.invoice.reversed}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">{formatDate(p.paid_on + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="px-3 py-2.5">
                          <StudentCell s={students.get(p.student_id)} />
                        </td>
                        <td className="px-3 py-2.5">
                          {f.methods[p.method]}
                          {p.reference && <span className="block font-mono text-xs text-slate-400">{p.reference}</span>}
                        </td>
                        <td className={cx('whitespace-nowrap px-3 py-2.5 text-right font-semibold', p.status === 'reversed' && 'line-through')}>{money(p.amount, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)} onChange={(n) => set({ page: n > 1 ? String(n) : null })} />
            </>
          )}
        </QueryView>
      </Panel>
      <RecordPaymentModal
        open={recording}
        onClose={() => setRecording(false)}
        onDone={(paymentId) => {
          setRecording(false);
          navigate(`/admin/finance/receipts/${paymentId}`);
        }}
      />
    </>
  );
}

export function ReceiptPage() {
  const { id = '' } = useParams();
  const { t, lang, pick, formatDate } = useLang();
  const f = t.admin.finance;
  const r = f.receipt;
  usePageMeta(r.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, FINANCE_MANAGE_ROLES);
  const inst = useInstitution();
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [reversing, setReversing] = useState(false);
  const payment = useQuery<(Payment & { allocations: { amount: number; invoice: { id: string; invoice_no: string; title_en: string; title_bn: string | null } | null }[] }) | null>(
    (db) => db.from('payments').select('*,allocations:payment_allocations(amount,invoice:student_invoices(id,invoice_no,title_en,title_bn))').eq('id', id).maybeSingle(),
    [id, reload],
  );
  const p = payment.state.status === 'ready' ? payment.state.data : null;
  const students = useFinanceStudents(p ? [p.student_id] : []);
  const names = useActorNames(p?.received_by ? [p.received_by] : []);

  return (
    <>
      <Link to="/admin/finance/payments" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <QueryView state={payment.state} retry={payment.retry} empty={t.admin.common.noRecords} isEmpty={(d) => d === null}>
        {(x) =>
          x && (
            <>
              <div className="no-print mb-4 flex flex-wrap justify-end gap-2">
                {canManage && x.status === 'posted' && (
                  <button type="button" onClick={() => setReversing(true)} className={buttonClass('outline', 'text-red-700')}>
                    <Undo2 className="h-4 w-4" aria-hidden />
                    {f.payment.reverse}
                  </button>
                )}
                <button type="button" onClick={() => window.print()} className={buttonClass('primary')}>
                  <Printer className="h-4 w-4" aria-hidden />
                  {t.admin.attendance.print}
                </button>
              </div>
              <article className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none sm:p-8">
                {x.status === 'reversed' && (
                  <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm font-semibold text-red-700">
                    {r.reversedNote} {x.reversal_reason && `(${x.reversal_reason})`}
                  </p>
                )}
                <header className="flex items-center gap-3 border-b-2 border-navy-900 pb-4">
                  <Logo className="h-14 w-14 shrink-0" />
                  <div className="flex-1">
                    <p className="heading text-lg font-bold text-navy-900">{pick(inst.name_en, inst.name_bn)}</p>
                    <p className="text-xs text-slate-600">{pick(inst.address_en, inst.address_bn)}</p>
                  </div>
                  <div className="text-right">
                    <p className="flex items-center justify-end gap-1 text-sm font-semibold uppercase tracking-wide text-royal-700">
                      <Receipt className="h-4 w-4" aria-hidden />
                      {r.title}
                    </p>
                    <p className="font-mono text-sm font-bold text-navy-900">{x.receipt_no}</p>
                    <p className="text-xs text-slate-500">{formatDate(x.paid_on + 'T00:00:00')}</p>
                  </div>
                </header>
                <dl className="mt-5 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">{r.receivedFrom}</dt>
                    <dd>
                      <StudentCell s={students.get(x.student_id)} />
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-8">
                    <div>
                      <dt className="text-xs text-slate-500">{r.amountInWords}</dt>
                      <dd className={cx('text-2xl font-bold text-navy-900', x.status === 'reversed' && 'line-through')}>{money(x.amount, lang)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">{f.columns.method}</dt>
                      <dd className="font-semibold text-navy-900">
                        {f.methods[x.method]}
                        {x.reference && <span className="block font-mono text-xs text-slate-500">{x.reference}</span>}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{r.appliedTo}</dt>
                    <dd>
                      <ul className="mt-1 divide-y divide-slate-100">
                        {x.allocations.map((a) => (
                          <li key={a.invoice?.id} className="flex justify-between gap-3 py-1.5">
                            <span>
                              <Link to={`/admin/finance/invoices/${a.invoice?.id}`} className="font-mono text-royal-700 hover:underline">
                                {a.invoice?.invoice_no}
                              </Link>{' '}
                              {a.invoice && pick(a.invoice.title_en, a.invoice.title_bn)}
                            </span>
                            <span className="font-semibold">{money(a.amount, lang)}</span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  {x.note && <p className="text-slate-600">{x.note}</p>}
                </dl>
                <footer className="mt-14 grid grid-cols-2 gap-8 text-center text-xs text-slate-600">
                  <div className="border-t border-slate-400 pt-2">
                    {r.receivedBy}
                    {x.received_by && names[x.received_by] && `: ${names[x.received_by]}`}
                  </div>
                  <div className="border-t border-slate-400 pt-2">{r.signature}</div>
                </footer>
              </article>
              <ReasonModal
                open={reversing}
                title={f.payment.reverseTitle}
                hint={f.payment.reverseHelp}
                danger
                onClose={() => setReversing(false)}
                onSubmit={async (reason) => {
                  const { error } = await supabase!.rpc('reverse_payment', { p_payment: x.id, p_reason: reason });
                  if (error) return financeError(t, error);
                  setReversing(false);
                  toast('success', f.payment.reversedDone);
                  setReload((n) => n + 1);
                  return null;
                }}
              />
            </>
          )
        }
      </QueryView>
    </>
  );
}

// ====================================================================
// Bulk billing
// ====================================================================
interface FeeStructure {
  id: string;
  medium: Medium | null;
  amount: number;
  frequency: string;
  is_active: boolean;
  category: { name_en: string; name_bn: string | null } | null;
}

export function GenerateInvoicesPage() {
  const { t, lang, pick } = useLang();
  const g = t.admin.finance.generate;
  usePageMeta(g.title, undefined, { noindex: true });
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const years = useYears();
  const classes = useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('id,code,name_en,name_bn,level,is_active,class_streams(class_id,medium,admission_open)').eq('is_active', true).order('level'),
    [],
  );
  const [yearId, setYearId] = useState('');
  const [medium, setMedium] = useState<Medium>('bangla_medium');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState(schoolToday().slice(0, 7));
  const [issueDate, setIssueDate] = useState(schoolToday());
  const [dueDate, setDueDate] = useState(addDays(schoolToday(), 10));
  const [titleEn, setTitleEn] = useState('');
  const [titleBn, setTitleBn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!yearId && years.state.status === 'ready' && years.state.data.length) {
      setYearId((years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id);
    }
  }, [years.state, yearId]);

  const sections = useQuery<{ id: string; name: string }[]>(
    (db) =>
      yearId && classId
        ? db.from('sections').select('id,name').eq('academic_year_id', yearId).eq('class_id', classId).eq('medium', medium).order('name')
        : Promise.resolve({ data: [], error: null }),
    [yearId, classId, medium],
  );
  const structures = useQuery<FeeStructure[]>(
    (db) =>
      yearId && classId
        ? db
            .from('fee_structures')
            .select('id,medium,amount,frequency,is_active,category:fee_categories(name_en,name_bn)')
            .eq('academic_year_id', yearId)
            .eq('class_id', classId)
            .eq('is_active', true)
            .or(`medium.is.null,medium.eq.${medium}`)
        : Promise.resolve({ data: [], error: null }),
    [yearId, classId, medium],
  );
  useEffect(() => setSelected([]), [yearId, classId, medium]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!yearId || !classId || !titleEn.trim()) return setError(t.admin.common.required);
    if (selected.length === 0) return setError(t.admin.finance.errors.NO_FEES_SELECTED);
    setBusy(true);
    const { data, error: err } = await supabase!.rpc('generate_invoices', {
      p_year: yearId,
      p_class: classId,
      p_medium: medium,
      p_section: sectionId || null,
      p_structures: selected,
      p_period: period || null,
      p_issue_date: issueDate,
      p_due_date: dueDate,
      p_title_en: titleEn.trim(),
      p_title_bn: titleBn.trim() || null,
    });
    setBusy(false);
    if (err) return setError(financeError(t, err));
    const r = data as { created: number; skipped: number };
    toast('success', g.result(r.created, r.skipped));
  };

  return (
    <>
      <AdminPageHeader title={g.title} subtitle={g.subtitle} />
      <form onSubmit={submit} noValidate className="space-y-6">
        <Panel>
          <InlineNotice>{g.help}</InlineNotice>
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <SelectField
              label={g.year}
              value={yearId}
              onChange={(e) => setYearId(e.target.value)}
              options={years.state.status === 'ready' ? years.state.data.map((y) => ({ value: y.id, label: pick(y.name_en, y.name_bn) })) : []}
            />
            <SelectField
              label={g.medium}
              value={medium}
              onChange={(e) => {
                setMedium(e.target.value as Medium);
                setClassId('');
              }}
              options={MEDIUMS.map((m) => ({ value: m, label: mediumLabel(m) }))}
            />
            <SelectField
              label={g.class}
              required
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId('');
              }}
              options={[
                { value: '', label: t.apply.select },
                ...(classes.state.status === 'ready'
                  ? classes.state.data.filter((c) => c.class_streams.some((s) => s.medium === medium)).map((c) => ({ value: c.id, label: pick(c.name_en, c.name_bn) }))
                  : []),
              ]}
            />
            <SelectField
              label={g.section}
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              options={[{ value: '', label: g.allSections }, ...(sections.state.status === 'ready' ? sections.state.data.map((s) => ({ value: s.id, label: s.name })) : [])]}
            />
          </div>
        </Panel>

        {classId && (
          <Panel title={g.fees}>
            {structures.state.status === 'ready' && structures.state.data.length === 0 ? (
              <InlineNotice tone="warning">{g.noFees}</InlineNotice>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {structures.state.status === 'ready' &&
                  structures.state.data.map((s) => (
                    <li key={s.id}>
                      <label className={cx('flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm', selected.includes(s.id) ? 'border-royal-300 bg-royal-50/60' : 'border-slate-200')}>
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected.includes(s.id)}
                            onChange={(e) => setSelected((x) => (e.target.checked ? [...x, s.id] : x.filter((id) => id !== s.id)))}
                            className="h-4 w-4 rounded border-navy-300 text-royal-600"
                          />
                          <span>
                            <span className="font-medium text-navy-900">{s.category ? pick(s.category.name_en, s.category.name_bn) : ''}</span>
                            <span className="block text-xs text-slate-500">{t.admin.finance.setup.frequencies[s.frequency]}</span>
                          </span>
                        </span>
                        <span className="font-semibold text-navy-900">{money(s.amount, lang)}</span>
                      </label>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>
        )}

        <Panel>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField label={g.period} value={period} onChange={(e) => setPeriod(e.target.value)} hint={g.periodHint} maxLength={7} />
            <TextField label={g.issueDate} type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            <TextField label={g.dueDate} type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <TextField label={g.titleEn} required className="md:col-span-1" value={titleEn} maxLength={150} onChange={(e) => setTitleEn(e.target.value)} />
            <TextField label={g.titleBn} lang="bn" className="md:col-span-2" value={titleBn} maxLength={150} onChange={(e) => setTitleBn(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end">
            <button type="submit" disabled={busy} className={buttonClass('primary')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {g.run}
            </button>
          </div>
        </Panel>
      </form>
    </>
  );
}
