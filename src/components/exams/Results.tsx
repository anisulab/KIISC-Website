import { Link } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { useInstitution } from '@/hooks/useInstitution';
import { useQuery } from '@/hooks/useQuery';
import { formatNumber, type ResultRow } from '@/lib/exams';
import type { Medium } from '@/lib/academics';
import { Logo, QueryView, Spinner, buttonClass, cx } from '@/components/ui';
import { useMediumLabel } from '@/components/admissions';

export function ResultBadge({ row }: { row: Pick<ResultRow, 'passed' | 'incomplete'> }) {
  const { t } = useLang();
  const r = t.admin.exams.results;
  const [label, tone] = row.incomplete
    ? [r.incomplete, 'bg-slate-100 text-slate-600']
    : row.passed
      ? [r.passed, 'bg-emerald-100 text-emerald-800']
      : [r.failed, 'bg-red-100 text-red-700'];
  return <span className={cx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tone)}>{label}</span>;
}

/** Server-calculated results for one section; each row links to a report card. */
export function ResultsTable({ examId, sectionId, reportLink }: { examId: string; sectionId: string; reportLink: (studentId: string) => string }) {
  const { t, lang, pick } = useLang();
  const r = t.admin.exams.results;
  const { state, retry } = useQuery<ResultRow[]>((db) => db.rpc('exam_section_results', { p_exam: examId, p_section: sectionId }), [examId, sectionId]);
  const n = (v: number | null, d = 2) => formatNumber(v, lang, d);
  return (
    <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
      {(rows) => (
        <div className="-mx-5 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">{r.position}</th>
                <th className="px-3 py-2 font-semibold">{t.admin.students.columns.name}</th>
                <th className="px-3 py-2 text-right font-semibold">{r.total}</th>
                <th className="px-3 py-2 text-right font-semibold">{r.percentage}</th>
                <th className="px-3 py-2 text-right font-semibold">{r.gpa}</th>
                <th className="px-3 py-2 font-semibold">{r.grade}</th>
                <th className="px-3 py-2 font-semibold">{r.result}</th>
                <th className="no-print px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.student_id}>
                  <td className="px-3 py-2 font-semibold text-navy-900">{row.merit_position ? n(row.merit_position, 0) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-navy-900">{pick(row.name_en, row.name_bn)}</span>
                    <span className="block font-mono text-xs text-slate-400">
                      {row.student_code}
                      {row.roll_no != null && ` · ${t.admin.exams.reportCard.roll} ${n(row.roll_no, 0)}`}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {n(row.total_obtained)} / {n(row.total_full, 0)}
                  </td>
                  <td className="px-3 py-2 text-right">{n(row.percentage)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatNumber(row.gpa, lang, 2, true)}</td>
                  <td className="px-3 py-2 font-semibold">{row.grade ?? '—'}</td>
                  <td className="px-3 py-2">
                    <ResultBadge row={row} />
                    {row.failed_subjects > 0 && <span className="ml-2 text-xs text-red-700">({n(row.failed_subjects, 0)})</span>}
                  </td>
                  <td className="no-print px-3 py-2 text-right">
                    <Link to={reportLink(row.student_id)} className={buttonClass('ghost', 'px-2 py-1 text-xs')}>
                      <FileText className="h-4 w-4" aria-hidden />
                      {r.reportCard}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </QueryView>
  );
}

interface ReportCardData {
  examination: { id: string; name_en: string; name_bn: string | null; status: string; year_en: string; year_bn: string | null };
  student: { student_code: string; name_en: string; name_bn: string | null; medium: Medium };
  section: { name: string; class_name_en: string; class_name_bn: string | null; roll_no: number | null };
  subjects: {
    name_en: string;
    name_bn: string | null;
    full_marks: number;
    pass_marks: number;
    marks: number | null;
    mark_status: 'present' | 'absent' | 'exempt' | null;
    grade: string | null;
    grade_point: number | null;
    failed: boolean;
    incomplete: boolean;
  }[];
  result: Omit<ResultRow, 'student_id' | 'student_code' | 'name_en' | 'name_bn' | 'roll_no'> | null;
}

/** Printable bilingual report card, calculated and permission-checked on the server. */
export function ReportCard({ examId, studentId }: { examId: string; studentId: string }) {
  const { t, lang, pick } = useLang();
  const rc = t.admin.exams.reportCard;
  const r = t.admin.exams.results;
  const inst = useInstitution();
  const mediumLabel = useMediumLabel();
  const { state, retry } = useQuery<ReportCardData>((db) => db.rpc('exam_report_card', { p_exam: examId, p_student: studentId }), [examId, studentId]);
  const n = (v: number | null | undefined, d = 2) => formatNumber(v ?? null, lang, d);

  if (state.status === 'loading') return <Spinner />;
  return (
    <QueryView state={state} retry={retry} empty={t.admin.common.noRecords} isEmpty={(d) => !d}>
      {(d) => (
        <div>
          <div className="no-print mb-4 flex justify-end">
            <button type="button" onClick={() => window.print()} className={buttonClass('primary')}>
              <Printer className="h-4 w-4" aria-hidden />
              {t.admin.attendance.print}
            </button>
          </div>
          <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none sm:p-10">
            {d.examination.status !== 'published' && (
              <p className="mb-4 rounded-lg bg-gold-100 px-3 py-2 text-center text-xs font-semibold text-gold-600">{rc.unpublishedNote}</p>
            )}
            <header className="flex items-center gap-4 border-b-2 border-navy-900 pb-4">
              <Logo className="h-16 w-16 shrink-0" />
              <div className="flex-1 text-center">
                <p className="heading text-xl font-bold text-navy-900">{pick(inst.name_en, inst.name_bn)}</p>
                <p className="text-xs text-slate-600">{pick(inst.address_en, inst.address_bn)}</p>
                <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-royal-700">
                  {rc.title} · {pick(d.examination.name_en, d.examination.name_bn)}
                </p>
                <p className="text-xs text-slate-500">{pick(d.examination.year_en, d.examination.year_bn)}</p>
              </div>
              <span className="w-16" aria-hidden />
            </header>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {[
                [t.admin.students.columns.name, pick(d.student.name_en, d.student.name_bn)],
                [rc.studentId, d.student.student_code],
                [t.admin.students.fields.medium, mediumLabel(d.student.medium)],
                [rc.class, pick(d.section.class_name_en, d.section.class_name_bn)],
                [rc.section, d.section.name],
                [rc.roll, n(d.section.roll_no, 0)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="font-semibold text-navy-900">{value}</dd>
                </div>
              ))}
            </dl>

            <table className="mt-6 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-navy-900 text-left text-xs uppercase tracking-wide text-white">
                  <th className="px-3 py-2">{rc.subject}</th>
                  <th className="px-3 py-2 text-right">{rc.full}</th>
                  <th className="px-3 py-2 text-right">{rc.obtained}</th>
                  <th className="px-3 py-2 text-center">{rc.grade}</th>
                  <th className="px-3 py-2 text-right">{rc.gp}</th>
                </tr>
              </thead>
              <tbody>
                {d.subjects.map((s) => (
                  <tr key={s.name_en} className="border-b border-slate-200">
                    <td className="px-3 py-2 font-medium text-navy-900">{pick(s.name_en, s.name_bn)}</td>
                    <td className="px-3 py-2 text-right">{n(s.full_marks, 0)}</td>
                    <td className={cx('px-3 py-2 text-right font-semibold', s.failed && 'text-red-700')}>
                      {s.mark_status === 'absent' ? rc.absent : s.mark_status === 'exempt' ? rc.exempt : s.incomplete ? '—' : n(s.marks)}
                    </td>
                    <td className={cx('px-3 py-2 text-center font-semibold', s.failed && 'text-red-700')}>{s.grade ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{n(s.grade_point)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {d.result && (
              <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl bg-navy-50 p-4 text-sm sm:grid-cols-5">
                {[
                  [r.total, `${n(d.result.total_obtained)} / ${n(d.result.total_full, 0)}`],
                  [r.percentage, n(d.result.percentage)],
                  [r.gpa, formatNumber(d.result.gpa, lang, 2, true)],
                  [r.grade, d.result.grade ?? '—'],
                  [r.position, d.result.merit_position ? n(d.result.merit_position, 0) : '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-lg font-bold text-navy-900">{value}</p>
                  </div>
                ))}
                <div className="col-span-2 sm:col-span-5">
                  <ResultBadge row={d.result} />
                </div>
              </div>
            )}

            <footer className="mt-16 grid grid-cols-3 gap-6 text-center text-xs text-slate-600">
              {[rc.classTeacher, rc.guardian, rc.principal].map((label) => (
                <div key={label} className="border-t border-slate-400 pt-2">
                  {label}
                </div>
              ))}
            </footer>
          </article>
        </div>
      )}
    </QueryView>
  );
}
