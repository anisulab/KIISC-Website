import type { Medium } from './academics';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'leave'];

export const STATUS_TONES: Record<AttendanceStatus, { on: string; off: string }> = {
  present: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
  absent: { on: 'bg-red-600 text-white border-red-600', off: 'text-red-700 border-red-200 hover:bg-red-50' },
  late: { on: 'bg-gold-500 text-navy-950 border-gold-500', off: 'text-gold-600 border-gold-300 hover:bg-gold-100' },
  leave: { on: 'bg-royal-600 text-white border-royal-600', off: 'text-royal-700 border-royal-200 hover:bg-royal-50' },
};

/** Today's date in Bangladesh (matches public.school_today() on the server). */
export function schoolToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1 (Mon) … 7 (Sun) for a YYYY-MM-DD date. */
export function isoWeekday(isoDate: string) {
  const day = new Date(isoDate + 'T00:00:00Z').getUTCDay();
  return day === 0 ? 7 : day;
}

export function monthRange(isoDate: string) {
  const [y, m] = isoDate.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

export interface RosterRow {
  student_id: string;
  student_code: string;
  name_en: string;
  name_bn: string | null;
  roll_no: number | null;
}

export interface SummaryRow extends RosterRow {
  present: number;
  absent: number;
  late: number;
  on_leave: number;
  recorded_days: number;
}

export interface SectionInfo {
  id: string;
  name: string;
  medium: Medium;
  academic_year_id: string;
  class: { name_en: string; name_bn: string | null; level: number } | null;
}

/** Present + late, as a share of recorded days (rounded %), or null when nothing is recorded. */
export function attendanceRate(r: Pick<SummaryRow, 'present' | 'late' | 'recorded_days'>) {
  return r.recorded_days ? Math.round(((r.present + r.late) / r.recorded_days) * 100) : null;
}
