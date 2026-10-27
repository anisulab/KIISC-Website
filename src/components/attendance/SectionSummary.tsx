import { useState } from 'react';
import { useLang } from '@/i18n/LanguageProvider';
import { useQuery } from '@/hooks/useQuery';
import { attendanceRate, monthRange, schoolToday, type SummaryRow } from '@/lib/attendance';
import { QueryView, cx, inputClass } from '@/components/ui';

/** Per-student attendance totals for one section and date range (printable). */
export function SectionSummaryTable({ sectionId, from, to }: { sectionId: string; from: string; to: string }) {
  const { t, pick } = useLang();
  const at = t.admin.attendance;
  const { state, retry } = useQuery<SummaryRow[]>(
    (db) => db.rpc('attendance_section_summary', { p_section: sectionId, p_from: from, p_to: to }),
    [sectionId, from, to],
  );
  return (
    <QueryView state={state} retry={retry} empty={at.reports.empty} isEmpty={(rows) => rows.length === 0}>
      {(rows) => (
        <div className="-mx-5 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-14 px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">{t.admin.students.columns.name}</th>
                <th className="px-3 py-2 text-right font-semibold">{at.statuses.present}</th>
                <th className="px-3 py-2 text-right font-semibold">{at.statuses.absent}</th>
                <th className="px-3 py-2 text-right font-semibold">{at.statuses.late}</th>
                <th className="px-3 py-2 text-right font-semibold">{at.statuses.leave}</th>
                <th className="px-3 py-2 text-right font-semibold">{at.reports.days}</th>
                <th className="px-3 py-2 text-right font-semibold">{at.reports.rate}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const rate = attendanceRate(r);
                return (
                  <tr key={r.student_id}>
                    <td className="px-3 py-2 text-slate-500">{r.roll_no ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-navy-900">{pick(r.name_en, r.name_bn)}</span>
                      <span className="block font-mono text-xs text-slate-400">{r.student_code}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{r.present}</td>
                    <td className={cx('px-3 py-2 text-right', r.absent > 0 && 'font-semibold text-red-700')}>{r.absent}</td>
                    <td className="px-3 py-2 text-right">{r.late}</td>
                    <td className="px-3 py-2 text-right">{r.on_leave}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.recorded_days}</td>
                    <td className={cx('px-3 py-2 text-right font-semibold', rate !== null && rate < 75 ? 'text-red-700' : 'text-navy-900')}>
                      {rate === null ? '—' : `${rate}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </QueryView>
  );
}

/** Month picker that yields a from/to range. */
export function useMonthRange() {
  const [month, setMonth] = useState(schoolToday().slice(0, 7));
  const range = monthRange(month + '-01');
  return { month, setMonth, ...range };
}

export function MonthInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="text-sm font-semibold text-navy-800">
      {label}
      <input type="month" value={value} max={schoolToday().slice(0, 7)} onChange={(e) => e.target.value && onChange(e.target.value)} className={inputClass + ' mt-1.5'} />
    </label>
  );
}
