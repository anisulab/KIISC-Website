import type { Dict } from '@/i18n/en';
import type { Medium } from './academics';

export type PaymentMethod = 'cash' | 'bank' | 'mfs' | 'other';
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'bank', 'mfs', 'other'];
export const FEE_FREQUENCIES = ['one_time', 'monthly', 'per_term', 'per_exam', 'yearly'] as const;

export interface InvoiceSummary {
  id: string;
  invoice_no: string;
  student_id: string;
  academic_year_id: string;
  title_en: string;
  title_bn: string | null;
  period: string | null;
  issue_date: string;
  due_date: string;
  status: 'issued' | 'cancelled';
  cancel_reason: string | null;
  total: number;
  paid: number;
  balance: number;
}

export interface FinanceStudent {
  id: string;
  student_code: string;
  name_en: string;
  name_bn: string | null;
  medium: Medium;
  status: string;
  class_name_en: string | null;
  class_name_bn: string | null;
  section_name: string | null;
}

export interface Payment {
  id: string;
  receipt_no: string;
  student_id: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paid_on: string;
  note: string | null;
  received_by: string | null;
  received_at: string;
  status: 'posted' | 'reversed';
  reversal_reason: string | null;
}

export type InvoiceState = 'unpaid' | 'partial' | 'paid' | 'cancelled';

export function invoiceState(i: Pick<InvoiceSummary, 'status' | 'paid' | 'balance'>): InvoiceState {
  if (i.status === 'cancelled') return 'cancelled';
  if (Number(i.balance) <= 0) return 'paid';
  return Number(i.paid) > 0 ? 'partial' : 'unpaid';
}

export const INVOICE_STATE_TONES: Record<InvoiceState, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-gold-100 text-gold-600',
  paid: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-100 text-slate-500 line-through',
};

/** ৳1,500.00 / ৳১,৫০০.০০ (South Asian digit grouping). */
export function money(value: number | string | null | undefined, lang: 'bn' | 'en') {
  const n = Number(value ?? 0);
  return '৳' + new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function financeError(t: Dict, error: { message: string; code?: string } | null) {
  const e = t.admin.finance.errors;
  if (!error) return e.generic;
  return e[error.message] ?? (error.code ? e[error.code] : undefined) ?? e.generic;
}

/** Positive amount with at most two decimals. */
export function validAmount(value: string, allowNegative = false) {
  const re = allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  return re.test(value.trim()) && Number(value) !== 0 && (allowNegative || Number(value) > 0);
}
