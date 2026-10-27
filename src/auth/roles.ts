import type { AppRole, Me } from './AuthProvider';

export const ALL_ROLES: AppRole[] = [
  'super_admin',
  'school_admin',
  'principal',
  'accounts_officer',
  'admission_officer',
  'teacher',
  'student',
  'guardian',
];

/** Roles that use the admin console. Teachers, students and guardians get their own portals. */
export const STAFF_ROLES: AppRole[] = ['super_admin', 'school_admin', 'principal', 'accounts_officer', 'admission_officer'];
export const CONTENT_ROLES: AppRole[] = ['super_admin', 'school_admin'];
export const USER_ADMIN_ROLES: AppRole[] = ['super_admin', 'school_admin'];
export const SETTINGS_VIEW_ROLES: AppRole[] = ['super_admin', 'school_admin', 'principal'];
export const AUDIT_ROLES: AppRole[] = ['super_admin'];
export const ACADEMIC_ADMIN_ROLES: AppRole[] = ['super_admin', 'school_admin'];
export const ADMISSION_MANAGE_ROLES: AppRole[] = ['super_admin', 'school_admin', 'admission_officer'];
export const ADMISSION_VIEW_ROLES: AppRole[] = [...ADMISSION_MANAGE_ROLES, 'principal'];
export const TEACHING_ADMIN_ROLES: AppRole[] = ['super_admin', 'school_admin'];
export const FINANCE_MANAGE_ROLES: AppRole[] = ['super_admin', 'accounts_officer'];
export const FINANCE_VIEW_ROLES: AppRole[] = ['super_admin', 'accounts_officer', 'principal', 'school_admin'];
export const EXAM_MANAGE_ROLES: AppRole[] = ['super_admin', 'school_admin'];
export const RESULT_APPROVE_ROLES: AppRole[] = ['super_admin', 'principal'];
export const EXAM_VIEW_ROLES: AppRole[] = ['super_admin', 'school_admin', 'principal'];
export const ATTENDANCE_VIEW_ROLES: AppRole[] = ['super_admin', 'school_admin', 'principal'];
export const STUDENT_MANAGE_ROLES: AppRole[] = ['super_admin', 'school_admin'];
export const STUDENT_VIEW_ROLES: AppRole[] = [...STUDENT_MANAGE_ROLES, 'principal', 'admission_officer'];
/** Every staff role can run at least one report; the page lists only the reports each role may run. */
export const REPORT_ROLES: AppRole[] = STAFF_ROLES;
export const NOTIFICATION_ROLES: AppRole[] = ['super_admin', 'school_admin'];

export function hasAnyRole(me: Me | null, roles: AppRole[]) {
  return Boolean(me?.is_active && me.roles.some((r) => roles.includes(r)));
}
