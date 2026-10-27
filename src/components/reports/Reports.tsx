import { useState, type ReactNode } from 'react';
import { Download, Loader2, Printer } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { supabase } from '@/integrations/supabase/client';
import type { Dict } from '@/i18n/en';
import { csvFileName, toCsv, type CsvValue } from '@/lib/csv';
import { attendanceRate, schoolToday } from '@/lib/attendance';
import type { Medium } from '@/lib/academics';
import { formatNumber } from '@/lib/exams';
import { money } from '@/lib/finance';
import { useMediumLabel } from '@/components/admissions';
import { Logo, buttonClass, cx } from '@/components/ui';

export type ReportKind =
  | 'students'
  | 'admissions'
  | 'attendance_summary'
  | 'attendance_absences'
  | 'exam_results'
  | 'fee_collections'
  | 'fee_outstanding';

export type ReportRow = Record<string, unknown>;
export interface ReportSubject {
  id: string;
  name_en: string;
  name_bn: string | null;
}
export interface ReportResult {
  rows: ReportRow[];
  subjects?: ReportSubject[];
}

export interface ReportColumn {
  key: string;
  label: string;
  /** Value written to the CSV file (dates stay ISO, numbers stay plain). */
  value: (row: ReportRow) => CsvValue;
  /** On-screen / printed value; defaults to `value`. */
  show?: (row: ReportRow) => ReactNode;
  align?: 'right';
  /** Shown on screen and in print (default true). */
  screen?: boolean;
  /** Included in the CSV (default true). */
  csv?: boolean;
  /** Adds a total row on screen. */
  sum?: (row: ReportRow) => number;
  /** Formats the total. */
  showSum?: (total: number) => ReactNode;
}

/** Runs a server-side report; permissions are checked and the run is audited in the database. */
export async function runReport(kind: ReportKind, params: Record<string, string | number | null | undefined>) {
  if (!supabase) return { ok: false as const, code: 'unconfigured' };
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  const { data, error } = await supabase.rpc('export_report', { p_report: kind, p_params: clean });
  if (error) return { ok: false as const, code: error.message in REPORT_ERROR_CODES ? error.message : error.code ?? 'generic' };
  return { ok: true as const, data: data as ReportResult };
}

const REPORT_ERROR_CODES = { INVALID_RANGE: 1, INVALID_PARAMS: 1, UNKNOWN_REPORT: 1 };

export function reportError(t: Dict, code: string) {
  const e = t.admin.reports.errors;
  return e[code] ?? e.generic;
}

export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadReportCsv(columns: ReportColumn[], rows: ReportRow[], fileBase: string) {
  const cols = columns.filter((c) => c.csv !== false);
  downloadText(csvFileName(fileBase, schoolToday()), toCsv(cols.map((c) => c.label), rows.map((r) => cols.map((c) => c.value(r)))));
}

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Column definitions for each report, labelled in the active language. */
export function useReportColumns() {
  const { t, lang, pick, formatDate } = useLang();
  const mediumLabel = useMediumLabel();
  const c = t.admin.reports.cols;
  const res = t.admin.exams.results;
  const date = (v: unknown) => (str(v) ? formatDate(String(v) + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const n = (v: unknown, d = 2) => formatNumber(num(v), lang, d);

  const col = (key: string, label: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({
    key,
    label,
    value: (r) => (typeof r[key] === 'number' ? (r[key] as number) : str(r[key])),
    ...extra,
  });
  const code = (key = 'student_code') => col(key, c.student_code, { show: (r) => <span className="font-mono text-xs">{str(r[key]) ?? '—'}</span> });
  const names = (en = 'name_en', bnKey = 'name_bn'): ReportColumn[] => [
    col('name', c.name, { csv: false, value: (r) => pick(str(r[en]), str(r[bnKey])), show: (r) => <span className="font-medium text-navy-900">{pick(str(r[en]), str(r[bnKey]))}</span> }),
    col(en, c.name_en, { screen: false }),
    col(bnKey, c.name_bn, { screen: false }),
  ];
  const cls = col('class', c.class, { value: (r) => pick(str(r.class_name_en), str(r.class_name_bn)) || null });
  const dateCol = (key: string, label: string) => col(key, label, { show: (r) => date(r[key]) });
  const count = (key: string, label: string) => col(key, label, { align: 'right', show: (r) => n(r[key], 0) });
  const amount = (key: string, label: string, sum?: (r: ReportRow) => number) =>
    col(key, label, { align: 'right', value: (r) => num(r[key]), show: (r) => money(num(r[key]), lang), sum, showSum: (x) => money(x, lang) });
  const medium = col('medium', c.medium, { value: (r) => (str(r.medium) ? mediumLabel(String(r.medium) as Medium) : null) });
  const gender = col('gender', c.gender, { value: (r) => (str(r.gender) ? t.genders[String(r.gender) as keyof Dict['genders']] : null) });
  const mapped = (key: string, label: string, labels: Record<string, string>) =>
    col(key, label, { value: (r) => (str(r[key]) ? labels[String(r[key])] ?? String(r[key]) : null) });

  return (kind: ReportKind, result: ReportResult | null): ReportColumn[] => {
    switch (kind) {
      case 'students':
        return [
          code(),
          col('admission_no', c.admission_no, { screen: false }),
          ...names(),
          gender,
          dateCol('date_of_birth', c.date_of_birth),
          medium,
          cls,
          col('section_name', c.section),
          count('roll_no', c.roll),
          mapped('status', c.status, t.admin.students.statuses as Record<string, string>),
          mapped('enrollment_status', c.enrollment_status, t.admin.students.enrollmentStatuses as Record<string, string>),
          col('guardian_name', c.guardian_name),
          col('guardian_relationship', c.guardian_relationship, { screen: false }),
          col('guardian_phone', c.guardian_phone),
          col('guardian_email', c.guardian_email, { screen: false }),
        ];
      case 'admissions':
        return [
          col('reference_no', c.reference_no, { show: (r) => <span className="font-mono text-xs">{str(r.reference_no)}</span> }),
          dateCol('submitted_on', c.submitted_on),
          ...names('student_name_en', 'student_name_bn'),
          dateCol('date_of_birth', c.date_of_birth),
          gender,
          cls,
          medium,
          col('guardian_name', c.guardian_name),
          col('guardian_relationship', c.guardian_relationship, { screen: false }),
          col('guardian_phone', c.guardian_phone),
          col('guardian_email', c.guardian_email, { screen: false }),
          mapped('status', c.status, t.applicationStatuses as Record<string, string>),
        ];
      case 'attendance_summary':
        return [
          count('roll_no', c.roll),
          code(),
          ...names(),
          count('present', c.present),
          count('absent', c.absent),
          count('late', c.late),
          count('on_leave', c.leave),
          count('recorded_days', c.recorded_days),
          col('rate', c.rate, {
            align: 'right',
            value: (r) => attendanceRate({ present: Number(r.present), late: Number(r.late), recorded_days: Number(r.recorded_days) }),
            show: (r) => {
              const rate = attendanceRate({ present: Number(r.present), late: Number(r.late), recorded_days: Number(r.recorded_days) });
              return rate === null ? '—' : `${n(rate, 0)}%`;
            },
          }),
        ];
      case 'attendance_absences':
        return [code(), ...names(), cls, col('section_name', c.section), count('absent', c.absent), count('recorded_days', c.recorded_days)];
      case 'exam_results':
        return [
          count('merit_position', c.position),
          count('roll_no', c.roll),
          code(),
          ...names(),
          ...(result?.subjects ?? []).map((s) =>
            col(`subject:${s.id}`, pick(s.name_en, s.name_bn), {
              align: 'right',
              value: (r) => {
                const v = (r.marks as Record<string, unknown> | undefined)?.[s.id];
                return typeof v === 'number' ? v : str(v);
              },
              show: (r) => {
                const v = (r.marks as Record<string, unknown> | undefined)?.[s.id];
                return typeof v === 'number' ? n(v) : (str(v) ?? '—');
              },
            }),
          ),
          col('total_obtained', c.total, { align: 'right', show: (r) => `${n(r.total_obtained)} / ${n(r.total_full, 0)}` }),
          col('total_full', c.full_marks, { screen: false }),
          col('percentage', res.percentage, { align: 'right', show: (r) => n(r.percentage) }),
          col('gpa', res.gpa, { align: 'right', show: (r) => formatNumber(num(r.gpa), lang, 2, true) }),
          col('grade', res.grade),
          col('result', res.result, {
            value: (r) => (r.incomplete ? res.incomplete : r.passed ? res.passed : res.failed),
            show: (r) => (
              <span className={cx('font-semibold', r.incomplete ? 'text-slate-500' : r.passed ? 'text-emerald-700' : 'text-red-700')}>
                {r.incomplete ? res.incomplete : r.passed ? res.passed : res.failed}
              </span>
            ),
          }),
          count('failed_subjects', res.failedSubjects),
        ];
      case 'fee_collections':
        return [
          col('receipt_no', c.receipt_no, { show: (r) => <span className="font-mono text-xs">{str(r.receipt_no)}</span> }),
          dateCol('paid_on', c.paid_on),
          code(),
          ...names(),
          cls,
          col('section_name', c.section, { screen: false }),
          mapped('method', c.method, t.admin.finance.methods),
          col('reference', c.reference),
          amount('amount', c.amount, (r) => (r.status === 'posted' ? Number(r.amount) : 0)),
          col('status', c.status, {
            value: (r) => (r.status === 'reversed' ? t.admin.finance.invoice.reversed : c.posted),
            show: (r) => (r.status === 'reversed' ? <span className="font-semibold text-red-700">{t.admin.finance.invoice.reversed}</span> : c.posted),
          }),
        ];
      case 'fee_outstanding':
        return [
          code(),
          ...names(),
          cls,
          col('section_name', c.section),
          amount('invoiced', c.invoiced, (r) => Number(r.invoiced)),
          amount('paid', c.paid, (r) => Number(r.paid)),
          amount('balance', c.balance, (r) => Number(r.balance)),
          dateCol('oldest_due', c.oldest_due),
        ];
    }
  };
}

/** School letterhead shown only when printing / saving as PDF. */
export function PrintLetterhead({ title, lines = [] }: { title: string; lines?: string[] }) {
  const { t, pick, formatDate } = useLang();
  const inst = useInstitution();
  return (
    <div className="mb-4 hidden border-b-2 border-navy-900 pb-3 print:block">
      <div className="flex items-center gap-4">
        <Logo className="h-14 w-14 shrink-0" />
        <div className="flex-1 text-center">
          <p className="heading text-lg font-bold text-navy-900">{pick(inst.name_en, inst.name_bn)}</p>
          <p className="text-xs text-slate-600">{pick(inst.address_en, inst.address_bn)}</p>
          <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-royal-700">{title}</p>
          {lines.length > 0 && <p className="text-xs text-slate-600">{lines.join(' · ')}</p>}
        </div>
        <span className="w-14" aria-hidden />
      </div>
      <p className="mt-2 text-right text-[10px] text-slate-500">
        {t.admin.reports.generated(formatDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}
      </p>
    </div>
  );
}

/** Report rows as a table (screen and print), with optional totals. */
export function ReportTable({ columns, rows }: { columns: ReportColumn[]; rows: ReportRow[] }) {
  const { t } = useLang();
  const cols = columns.filter((c) => c.screen !== false);
  const hasSums = cols.some((c) => c.sum);
  const cell = (c: ReportColumn) => cx('px-3 py-2 print:px-1.5 print:py-1', c.align === 'right' && 'text-right tabular-nums');
  return (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm print:text-[11px]">
        <thead className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500 print:text-[10px] print:text-navy-900">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={cx(cell(c), 'font-semibold')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 print:divide-slate-300">
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className={cell(c)}>
                  {c.show ? c.show(r) : (c.value(r) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasSums && (
          <tfoot className="border-t-2 border-navy-900 font-bold text-navy-900">
            <tr>
              {cols.map((c, i) => (
                <td key={c.key} className={cell(c)}>
                  {c.sum ? (c.showSum ?? String)(rows.reduce((s, r) => s + (c.sum!(r) || 0), 0)) : i === 0 ? t.admin.reports.total : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Download CSV + print buttons for a report that has already been run. */
export function ReportActions({ onCsv }: { onCsv: () => void }) {
  const { t } = useLang();
  return (
    <div className="no-print flex flex-wrap gap-2">
      <button type="button" onClick={onCsv} className={buttonClass('outline')}>
        <Download className="h-4 w-4" aria-hidden />
        {t.admin.reports.downloadCsv}
      </button>
      <button type="button" onClick={() => window.print()} className={buttonClass('outline')}>
        <Printer className="h-4 w-4" aria-hidden />
        {t.admin.reports.printPdf}
      </button>
    </div>
  );
}

/** One-click CSV export of a server report (used beside existing on-screen reports). */
export function ExportCsvButton({
  kind,
  params,
  fileBase,
  disabled,
  onError,
}: {
  kind: ReportKind;
  params: Record<string, string | number | null | undefined>;
  fileBase: string;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const { t } = useLang();
  const columnsFor = useReportColumns();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={buttonClass('outline', 'no-print')}
      onClick={async () => {
        setBusy(true);
        const res = await runReport(kind, params);
        setBusy(false);
        if (!res.ok) return onError(reportError(t, res.code));
        downloadReportCsv(columnsFor(kind, res.data), res.data.rows, fileBase);
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
      {t.admin.reports.downloadCsv}
    </button>
  );
}
