import { useQuery } from '@/hooks/useQuery';

export type Medium = 'bangla_medium' | 'english_version';
export const MEDIUMS: Medium[] = ['bangla_medium', 'english_version'];

export type ApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'info_required'
  | 'approved'
  | 'rejected'
  | 'admitted'
  | 'withdrawn';
export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'info_required',
  'approved',
  'rejected',
  'admitted',
  'withdrawn',
];

/** Mirrors public.allowed_application_transitions() for the UI; the database enforces it. */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  submitted: ['under_review', 'info_required', 'rejected', 'withdrawn'],
  under_review: ['info_required', 'approved', 'rejected', 'withdrawn'],
  info_required: ['under_review', 'rejected', 'withdrawn'],
  approved: ['under_review'],
  rejected: ['under_review'],
  admitted: [],
  withdrawn: [],
};

export type Gender = 'male' | 'female' | 'third_gender';
export const GENDERS: Gender[] = ['male', 'female', 'third_gender'];

export interface AcademicYear {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
  admission_open: boolean;
}

export interface AcademicTerm {
  id: string;
  academic_year_id: string;
  name_en: string;
  name_bn: string | null;
  starts_on: string;
  ends_on: string;
  sort_order: number;
}

export interface SchoolClass {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  level: number;
  is_active: boolean;
}

export interface ClassStream {
  class_id: string;
  medium: Medium;
  admission_open: boolean;
}

export interface Subject {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
}

export interface AdmissionSettings {
  is_open: boolean;
  require_gender: boolean;
  require_guardian_email: boolean;
  require_previous_school: boolean;
  instructions_en: string | null;
  instructions_bn: string | null;
  eligibility_en: string | null;
  eligibility_bn: string | null;
}

export interface DocumentType {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  description_en: string | null;
  description_bn: string | null;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
}

export type ClassWithStreams = SchoolClass & { class_streams: ClassStream[] };

/** Active classes with the streams that offer them, ordered by level (public data). */
export function useClassOfferings() {
  return useQuery<ClassWithStreams[]>(
    (db) =>
      db
        .from('classes')
        .select('id,code,name_en,name_bn,level,is_active,class_streams(class_id,medium,admission_open)')
        .eq('is_active', true)
        .order('level'),
    [],
  );
}

export function useAdmissionSettings() {
  return useQuery<AdmissionSettings | null>(
    (db) =>
      db
        .from('admission_settings')
        .select('is_open,require_gender,require_guardian_email,require_previous_school,instructions_en,instructions_bn,eligibility_en,eligibility_bn')
        .maybeSingle(),
    [],
  );
}

export function useDocumentTypes(activeOnly = true) {
  return useQuery<DocumentType[]>(
    (db) => {
      let q = db
        .from('admission_document_types')
        .select('id,code,name_en,name_bn,description_en,description_bn,is_required,is_active,sort_order');
      if (activeOnly) q = q.eq('is_active', true);
      return q.order('sort_order').order('name_en');
    },
    [activeOnly],
  );
}

export interface SectionOption {
  id: string;
  name: string;
}

/** Sections of one year/class/stream (staff only). Empty until all three are chosen. */
export function useSections(yearId: string | null | undefined, classId: string | null | undefined, medium: Medium | '' | null | undefined) {
  return useQuery<SectionOption[]>(
    (db) =>
      yearId && classId && medium
        ? db.from('sections').select('id,name').eq('academic_year_id', yearId).eq('class_id', classId).eq('medium', medium).order('name')
        : Promise.resolve({ data: [], error: null }),
    [yearId, classId, medium],
  );
}

/** Whole years between a date of birth and today. */
export function ageInYears(dob: string) {
  const d = new Date(dob + 'T00:00:00');
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age;
}

/** Mirrors public.normalize_bd_phone(). */
export function normalizeBdPhone(value: string) {
  let d = value.replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  return /^01[3-9]\d{8}$/.test(d) ? d : null;
}
