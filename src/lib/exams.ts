import type { Dict } from '@/i18n/en';
import type { Medium } from './academics';

export type ExamStatus = 'draft' | 'marks_entry' | 'under_review' | 'approved' | 'published';
export type MarkStatus = 'present' | 'absent' | 'exempt';
export const MARK_STATUSES: MarkStatus[] = ['present', 'absent', 'exempt'];

export interface Exam {
  id: string;
  academic_year_id: string;
  term_id: string | null;
  name_en: string;
  name_bn: string | null;
  grading_scheme_id: string;
  absent_policy: 'count_as_zero' | 'mark_incomplete';
  starts_on: string | null;
  ends_on: string | null;
  status: ExamStatus;
}

export interface ExamSubject {
  id: string;
  examination_id: string;
  class_id: string;
  medium: Medium;
  subject_id: string;
  full_marks: number;
  pass_marks: number;
  exam_date: string | null;
  include_in_total: boolean;
  sort_order: number;
  subject?: { name_en: string; name_bn: string | null } | null;
  class?: { name_en: string; name_bn: string | null; level: number } | null;
}

export interface ResultRow {
  student_id: string;
  student_code: string;
  name_en: string;
  name_bn: string | null;
  roll_no: number | null;
  total_obtained: number | null;
  total_full: number | null;
  percentage: number | null;
  gpa: number | null;
  grade: string | null;
  passed: boolean;
  incomplete: boolean;
  failed_subjects: number;
  merit_position: number | null;
}

/** Workflow buttons shown for each status; the database enforces who may use them. */
export const EXAM_ACTIONS: Record<ExamStatus, { to: ExamStatus; label: keyof Dict['admin']['exams']['actions']; who: 'manage' | 'approve' | 'either' }[]> = {
  draft: [{ to: 'marks_entry', label: 'marks_entry', who: 'manage' }],
  marks_entry: [
    { to: 'under_review', label: 'under_review', who: 'manage' },
    { to: 'draft', label: 'draft', who: 'manage' },
  ],
  under_review: [
    { to: 'approved', label: 'approved', who: 'approve' },
    { to: 'marks_entry', label: 'reopen', who: 'either' },
  ],
  approved: [
    { to: 'published', label: 'published', who: 'approve' },
    { to: 'under_review', label: 'backToReview', who: 'approve' },
  ],
  published: [{ to: 'approved', label: 'unpublish', who: 'approve' }],
};

export const EXAM_STATUS_TONES: Record<ExamStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  marks_entry: 'bg-royal-50 text-royal-700',
  under_review: 'bg-gold-100 text-gold-600',
  approved: 'bg-emerald-100 text-emerald-800',
  published: 'bg-navy-900 text-white',
};

export function examError(t: Dict, error: { message: string; code?: string } | null) {
  const e = t.admin.exams.errors;
  if (!error) return e.generic;
  return e[error.message] ?? (error.code ? e[error.code] : undefined) ?? e.generic;
}

/** Valid marks: 0..full, at most two decimals. */
export function validMarks(value: string, full: number) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return false;
  const n = Number(value);
  return n >= 0 && n <= full;
}

/** Locale digits; whole numbers drop decimals unless `fixed` (e.g. GPA is always shown as 0.00). */
export function formatNumber(n: number | null | undefined, lang: 'bn' | 'en', digits = 2, fixed = false) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  const text = Number.isInteger(v) && !fixed ? String(v) : v.toFixed(digits);
  return lang === 'bn' ? text.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]) : text;
}
