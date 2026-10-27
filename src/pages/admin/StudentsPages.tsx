import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import type { PostgrestError } from '@supabase/supabase-js';
import { useLang } from '@/i18n/LanguageProvider';
import type { Dict } from '@/i18n/en';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { FINANCE_VIEW_ROLES, STUDENT_MANAGE_ROLES, hasAnyRole } from '@/auth/roles';
import { StudentFeesPanel } from './FinancePages';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeSearch } from '@/lib/content';
import {
  GENDERS,
  MEDIUMS,
  ageInYears,
  normalizeBdPhone,
  useSections,
  type AcademicYear,
  type ClassWithStreams,
  type Gender,
  type Medium,
} from '@/lib/academics';
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES, openPrivateFile, uploadPrivateFile } from '@/lib/storage';
import { Pagination, QueryView, Spinner, buttonClass, cx, inputClass } from '@/components/ui';
import {
  AdminPageHeader,
  ConfirmDialog,
  InlineNotice,
  Modal,
  Panel,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@/components/admin/adminUi';
import { EntityModal, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { useMediumLabel } from '@/components/admissions';

export type StudentStatus = 'active' | 'transferred' | 'withdrawn' | 'graduated';
export type EnrollmentStatus = 'enrolled' | 'promoted' | 'retained' | 'transferred' | 'withdrawn' | 'graduated';
const STUDENT_STATUSES: StudentStatus[] = ['active', 'transferred', 'withdrawn', 'graduated'];
const PAGE_SIZE = 25;
const STUDENT_BUCKET = 'student-documents';

/** Maps database errors from the student functions to translated messages. */
export function studentError(t: Dict, error: Pick<PostgrestError, 'message' | 'code'> | null) {
  const e = t.admin.students.errors;
  if (!error) return e.generic;
  return e[error.message] ?? e[error.code] ?? e.generic;
}

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  const { t } = useLang();
  const tone = {
    active: 'bg-emerald-100 text-emerald-800',
    transferred: 'bg-gold-100 text-gold-600',
    withdrawn: 'bg-slate-100 text-slate-600',
    graduated: 'bg-navy-900 text-white',
  }[status];
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tone)}>{t.admin.students.statuses[status]}</span>;
}

function useYears() {
  return useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
}

function useClasses() {
  return useQuery<ClassWithStreams[]>(
    (db) => db.from('classes').select('id,code,name_en,name_bn,level,is_active,class_streams(class_id,medium,admission_open)').order('level'),
    [],
  );
}

// ====================================================================
// List
// ====================================================================
interface StudentRow {
  id: string;
  student_code: string;
  name_en: string;
  name_bn: string | null;
  medium: Medium;
  status: StudentStatus;
  enrollment: {
    roll_no: number | null;
    class: { name_en: string; name_bn: string | null; level: number } | null;
    section: { name: string } | null;
  }[];
}

export function StudentsListPage() {
  const { t, pick } = useLang();
  const s = t.admin.students;
  usePageMeta(s.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, STUDENT_MANAGE_ROLES);
  const mediumLabel = useMediumLabel();
  const [params, setParams] = useSearchParams();
  const years = useYears();
  const classes = useClasses();

  const yearList = years.state.status === 'ready' ? years.state.data : [];
  const defaultYear = (yearList.find((y) => y.is_current) ?? yearList[0])?.id ?? '';
  const year = params.get('year') || defaultYear;
  const cls = params.get('class') ?? '';
  const medium = (MEDIUMS as string[]).includes(params.get('medium') ?? '') ? (params.get('medium') as Medium) : '';
  const section = params.get('section') ?? '';
  const status = (STUDENT_STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as StudentStatus) : '';
  const q = sanitizeSearch(params.get('q') ?? '');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draftQ, setDraftQ] = useState(q);
  const sections = useSections(year, cls, medium);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const { state, retry } = useQuery<StudentRow[]>(
    (db) => {
      if (!year) return Promise.resolve({ data: [], error: null, count: 0 });
      let query = db
        .from('students')
        .select(
          'id,student_code,name_en,name_bn,medium,status,' +
            'enrollment:student_enrollments!inner(academic_year_id,class_id,section_id,roll_no,class:classes(name_en,name_bn,level),section:sections(name))',
          { count: 'exact' },
        )
        .eq('enrollment.academic_year_id', year);
      if (cls) query = query.eq('enrollment.class_id', cls);
      if (section) query = query.eq('enrollment.section_id', section);
      if (medium) query = query.eq('medium', medium);
      if (status) query = query.eq('status', status);
      if (q) query = query.or(`name_en.ilike.*${q}*,name_bn.ilike.*${q}*,student_code.ilike.*${q}*,admission_no.ilike.*${q}*`);
      const from = (page - 1) * PAGE_SIZE;
      return query.order('name_en').range(from, from + PAGE_SIZE - 1);
    },
    [year, cls, section, medium, status, q, page],
  );

  const filter = inputClass + ' lg:w-auto';
  return (
    <>
      <AdminPageHeader
        title={s.title}
        subtitle={s.subtitle}
        actions={
          canManage ? (
            <Link to="new" className={buttonClass('primary')}>
              <UserPlus className="h-4 w-4" aria-hidden />
              {s.add}
            </Link>
          ) : undefined
        }
      />
      <Panel>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <form
            role="search"
            className="flex gap-2 sm:col-span-2 lg:min-w-[16rem] lg:flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ q: sanitizeSearch(draftQ) || null, page: null });
            }}
          >
            <label htmlFor="student-search" className="sr-only">
              {t.common.search}
            </label>
            <input id="student-search" type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder={s.search} className={inputClass} maxLength={80} />
            <button type="submit" className={buttonClass('outline', 'px-3')} aria-label={t.common.search}>
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <select aria-label={s.fields.year} value={year} onChange={(e) => setParam({ year: e.target.value, section: null, page: null })} className={filter}>
            {yearList.map((y) => (
              <option key={y.id} value={y.id}>
                {pick(y.name_en, y.name_bn)}
              </option>
            ))}
          </select>
          <select aria-label={s.fields.medium} value={medium} onChange={(e) => setParam({ medium: e.target.value || null, section: null, page: null })} className={filter}>
            <option value="">{t.admin.admissions.allMediums}</option>
            {MEDIUMS.map((m) => (
              <option key={m} value={m}>
                {mediumLabel(m)}
              </option>
            ))}
          </select>
          <select aria-label={s.fields.class} value={cls} onChange={(e) => setParam({ class: e.target.value || null, section: null, page: null })} className={filter}>
            <option value="">{t.admin.admissions.allClasses}</option>
            {classes.state.status === 'ready' &&
              classes.state.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.name_en, c.name_bn)}
                </option>
              ))}
          </select>
          <select
            aria-label={s.fields.section}
            value={section}
            disabled={!cls || !medium}
            onChange={(e) => setParam({ section: e.target.value || null, page: null })}
            className={filter}
          >
            <option value="">{s.allSections}</option>
            {sections.state.status === 'ready' &&
              sections.state.data.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
          <select aria-label={s.columns.status} value={status} onChange={(e) => setParam({ status: e.target.value || null, page: null })} className={filter}>
            <option value="">{t.admin.common.allStatuses}</option>
            {STUDENT_STATUSES.map((x) => (
              <option key={x} value={x}>
                {s.statuses[x]}
              </option>
            ))}
          </select>
        </div>
        <p className="mb-3 text-xs text-slate-500">{s.yearNote}</p>
        <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
          {(rows, count) => (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{s.columns.id}</th>
                      <th className="px-3 py-2 font-semibold">{s.columns.name}</th>
                      <th className="px-3 py-2 font-semibold">{s.columns.classSection}</th>
                      <th className="px-3 py-2 font-semibold">{s.columns.roll}</th>
                      <th className="px-3 py-2 font-semibold">{s.columns.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const e = r.enrollment[0];
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
                            <Link to={r.id} className="font-semibold text-royal-700 hover:underline">
                              {r.student_code}
                            </Link>
                          </td>
                          <td className="px-3 py-3">
                            <Link to={r.id} className="font-medium text-navy-900 hover:text-royal-700">
                              {r.name_en}
                            </Link>
                            {r.name_bn && (
                              <span className="block text-xs text-slate-500" lang="bn">
                                {r.name_bn}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-slate-700">
                            {e?.class ? pick(e.class.name_en, e.class.name_bn) : '—'}
                            {e?.section && ` · ${e.section.name}`}
                            <span className="block text-xs text-slate-500">{mediumLabel(r.medium)}</span>
                          </td>
                          <td className="px-3 py-3 text-slate-700">{e?.roll_no ?? '—'}</td>
                          <td className="px-3 py-3">
                            <StudentStatusBadge status={r.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)} onChange={(p) => setParam({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

// ====================================================================
// Detail
// ====================================================================
interface StudentDetail {
  id: string;
  student_code: string;
  admission_no: string;
  application_id: string | null;
  user_id: string | null;
  name_en: string;
  name_bn: string | null;
  date_of_birth: string;
  gender: Gender | null;
  medium: Medium;
  status: StudentStatus;
  admission_date: string;
  left_on: string | null;
  leave_reason: string | null;
  previous_school: string | null;
  present_address: string | null;
  permanent_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  enrollments: {
    id: string;
    academic_year_id: string;
    class_id: string;
    medium: Medium;
    section_id: string | null;
    roll_no: number | null;
    status: EnrollmentStatus;
    start_date: string | null;
    end_date: string | null;
    year: { name_en: string; name_bn: string | null; starts_on: string } | null;
    class: { name_en: string; name_bn: string | null } | null;
    section: { name: string } | null;
  }[];
  guardians: {
    guardian_id: string;
    relationship: string;
    is_primary: boolean;
    verified_at: string | null;
    guardian: { id: string; name: string; phone: string; email: string | null; email_notifications: boolean; user_id: string | null } | null;
  }[];
  documents: {
    id: string;
    title: string;
    bucket: string;
    storage_path: string;
    file_name: string;
    size_bytes: number;
    uploaded_at: string;
  }[];
  application: { reference_no: string } | null;
}

function Detail({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-2.5">
          <dt className="text-slate-500">{label}</dt>
          <dd className="whitespace-pre-line break-words font-medium text-navy-900">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const iconButton = 'rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700';

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const { t, pick, formatDate } = useLang();
  const s = t.admin.students;
  usePageMeta(s.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, STUDENT_MANAGE_ROLES);
  const canSeeFees = hasAnyRole(me, FINANCE_VIEW_ROLES);
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const [reload, setReload] = useState(0);
  const refresh = () => setReload((n) => n + 1);

  const [modal, setModal] = useState<{ title: string; fields: EntityField[]; initial: EntityValues; save: (v: EntityValues) => Promise<string | null> } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; danger?: boolean; run: () => Promise<string | null> } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [accountFor, setAccountFor] = useState<{ kind: 'student' | 'guardian'; recordId: string; userId: string | null } | null>(null);

  const { state, retry } = useQuery<StudentDetail | null>(
    (db) =>
      db
        .from('students')
        .select(
          '*,' +
            'enrollments:student_enrollments(*,year:academic_years(name_en,name_bn,starts_on),class:classes(name_en,name_bn),section:sections(name)),' +
            'guardians:student_guardians(guardian_id,relationship,is_primary,verified_at,guardian:guardians(id,name,phone,email,email_notifications,user_id)),' +
            'documents:student_documents(id,title,bucket,storage_path,file_name,size_bytes,uploaded_at),' +
            'application:admission_applications(reference_no)',
        )
        .eq('id', id)
        .maybeSingle(),
    [id, reload],
  );
  const student = state.status === 'ready' ? state.data : null;

  const profileFields: EntityField[] = [
    { name: 'name_en', label: s.fields.name_en, type: 'text', required: true, maxLength: 150 },
    { name: 'name_bn', label: s.fields.name_bn, type: 'text', maxLength: 150, lang: 'bn' },
    { name: 'date_of_birth', label: s.fields.date_of_birth, type: 'date', required: true },
    { name: 'gender', label: s.fields.gender, type: 'select', options: [{ value: '', label: '—' }, ...GENDERS.map((g) => ({ value: g, label: t.genders[g] }))] },
    { name: 'admission_date', label: s.fields.admission_date, type: 'date', required: true },
    { name: 'previous_school', label: s.fields.previous_school, type: 'text', maxLength: 200 },
    { name: 'present_address', label: s.fields.present_address, type: 'textarea', maxLength: 500 },
    { name: 'permanent_address', label: s.fields.permanent_address, type: 'textarea', maxLength: 500 },
    { name: 'emergency_contact_name', label: s.fields.emergency_contact_name, type: 'text', maxLength: 150 },
    {
      name: 'emergency_contact_phone',
      label: s.fields.emergency_contact_phone,
      type: 'text',
      maxLength: 20,
      pattern: /^(\+?88)?01[3-9]\d{8}$/,
      patternMessage: s.errors.INVALID_PHONE,
    },
    { name: 'notes', label: s.fields.notes, type: 'textarea', maxLength: 2000 },
  ];

  const editProfile = (st: StudentDetail) =>
    setModal({
      title: s.editProfile,
      fields: profileFields,
      initial: Object.fromEntries(profileFields.map((f) => [f.name, String(st[f.name as keyof StudentDetail] ?? '')])),
      save: async (v) => {
        const payload = toEntityPayload(profileFields, v);
        if (payload.emergency_contact_phone) payload.emergency_contact_phone = normalizeBdPhone(String(payload.emergency_contact_phone));
        const { error } = await supabase!.from('students').update(payload).eq('id', st.id);
        return error ? studentError(t, error) : null;
      },
    });

  const editEnrollment = async (e: StudentDetail['enrollments'][number]) => {
    const { data } = await supabase!
      .from('sections')
      .select('id,name')
      .eq('academic_year_id', e.academic_year_id)
      .eq('class_id', e.class_id)
      .eq('medium', e.medium)
      .order('name');
    const fields: EntityField[] = [
      { name: 'section_id', label: s.fields.section, type: 'select', options: [{ value: '', label: '—' }, ...(data ?? []).map((x) => ({ value: x.id, label: x.name }))] },
      { name: 'roll_no', label: s.fields.roll_no, type: 'number' },
    ];
    setModal({
      title: s.editEnrollment,
      fields,
      initial: { section_id: e.section_id ?? '', roll_no: e.roll_no == null ? '' : String(e.roll_no) },
      save: async (v) => {
        const roll = String(v.roll_no ?? '').trim();
        if (roll && !(Number.isInteger(Number(roll)) && Number(roll) > 0)) return t.admin.academics.invalid;
        const { error } = await supabase!.from('student_enrollments').update(toEntityPayload(fields, v)).eq('id', e.id);
        return error ? studentError(t, error) : null;
      },
    });
  };

  const changeStatus = (st: StudentDetail) => {
    const fields: EntityField[] = [
      {
        name: 'status',
        label: s.newStatus,
        type: 'select',
        required: true,
        options: [{ value: '', label: t.apply.select }, ...STUDENT_STATUSES.filter((x) => x !== st.status).map((x) => ({ value: x, label: s.statuses[x] }))],
      },
      { name: 'date', label: s.date, type: 'date' },
      { name: 'reason', label: s.reason, type: 'textarea', maxLength: 500 },
    ];
    setModal({
      title: s.changeStatus,
      fields,
      initial: { status: '', date: new Date().toISOString().slice(0, 10), reason: '' },
      save: async (v) => {
        const { error } = await supabase!.rpc('change_student_status', {
          p_student: st.id,
          p_status: v.status,
          p_date: v.date || null,
          p_reason: String(v.reason ?? '').trim() || null,
        });
        if (error) return studentError(t, error);
        toast('success', s.statusChanged);
        return null;
      },
    });
  };

  const linkGuardian = (st: StudentDetail) => {
    const fields: EntityField[] = [
      { name: 'name', label: s.guardianName, type: 'text', required: true, maxLength: 150 },
      { name: 'relationship', label: s.relationship, type: 'text', required: true, maxLength: 50 },
      { name: 'phone', label: s.guardianPhone, type: 'text', required: true, maxLength: 20, pattern: /^(\+?88)?01[3-9]\d{8}$/, patternMessage: s.errors.INVALID_PHONE },
      { name: 'email', label: s.guardianEmail, type: 'text', maxLength: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: t.apply.errors.email },
      { name: 'primary', label: s.primary, type: 'checkbox', hint: s.linkHelp },
    ];
    setModal({
      title: s.linkGuardian,
      fields,
      initial: { name: '', relationship: '', phone: '', email: '', primary: st.guardians.length === 0 },
      save: async (v) => {
        const { error } = await supabase!.rpc('link_guardian', {
          p_student: st.id,
          p_name: String(v.name).trim(),
          p_phone: String(v.phone).trim(),
          p_email: String(v.email ?? '').trim() || null,
          p_relationship: String(v.relationship).trim(),
          p_primary: Boolean(v.primary),
        });
        return error ? studentError(t, error) : null;
      },
    });
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    const err = await confirm.run();
    setConfirmBusy(false);
    setConfirm(null);
    if (err) toast('error', err);
    else {
      toast('success', t.admin.common.saved);
      refresh();
    }
  };

  const openEnrollment = student?.enrollments.find((e) => e.status === 'enrolled');
  const enrollments = useMemo(
    () => [...(student?.enrollments ?? [])].sort((a, b) => (b.year?.starts_on ?? '').localeCompare(a.year?.starts_on ?? '')),
    [student],
  );

  return (
    <>
      <Link to="/admin/students" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <QueryView state={state} retry={retry} empty={t.admin.common.noRecords} isEmpty={(d) => d === null}>
        {(st) =>
          st && (
            <>
              <AdminPageHeader
                title={st.name_en}
                subtitle={`${st.student_code} · ${st.admission_no} · ${mediumLabel(st.medium)}`}
                actions={<StudentStatusBadge status={st.status} />}
              />
              <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
                <div className="space-y-6">
                  <Panel
                    title={s.profile}
                    actions={
                      canManage && (
                        <button type="button" onClick={() => editProfile(st)} className={buttonClass('ghost', 'px-2 py-1')}>
                          <Pencil className="h-4 w-4" aria-hidden />
                          {t.admin.common.edit}
                        </button>
                      )
                    }
                  >
                    <Detail
                      items={[
                        [s.fields.name_bn, st.name_bn && <span lang="bn">{st.name_bn}</span>],
                        [s.fields.date_of_birth, `${formatDate(st.date_of_birth + 'T00:00:00')} (${t.admin.admissions.age(ageInYears(st.date_of_birth))})`],
                        [s.fields.gender, st.gender && t.genders[st.gender]],
                        [s.fields.medium, mediumLabel(st.medium)],
                        [s.fields.admission_date, formatDate(st.admission_date + 'T00:00:00')],
                        [s.fields.previous_school, st.previous_school],
                        [s.fields.present_address, st.present_address],
                        [s.fields.permanent_address, st.permanent_address],
                        [s.fields.emergency_contact_name, st.emergency_contact_name],
                        [s.fields.emergency_contact_phone, st.emergency_contact_phone],
                        [
                          s.fromApplication,
                          st.application && st.application_id && (
                            <Link to={`/admin/admissions/${st.application_id}`} className="font-mono text-royal-700 hover:underline">
                              {st.application.reference_no}
                            </Link>
                          ),
                        ],
                        [s.fields.notes, st.notes],
                      ]}
                    />
                  </Panel>

                  <Panel
                    title={s.enrollments}
                    actions={
                      canManage &&
                      st.status === 'active' &&
                      !openEnrollment && (
                        <button type="button" onClick={() => setEnrolling(true)} className={buttonClass('ghost', 'px-2 py-1')}>
                          <Plus className="h-4 w-4" aria-hidden />
                          {s.enroll}
                        </button>
                      )
                    }
                  >
                    {!openEnrollment && st.status === 'active' && (
                      <div className="mb-3">
                        <InlineNotice tone="warning">{s.noOpenEnrollment}</InlineNotice>
                      </div>
                    )}
                    <div className="-mx-5 overflow-x-auto sm:mx-0">
                      <table className="w-full min-w-[520px] text-left text-sm">
                        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-semibold">{s.fields.year}</th>
                            <th className="px-3 py-2 font-semibold">{s.columns.classSection}</th>
                            <th className="px-3 py-2 font-semibold">{s.columns.roll}</th>
                            <th className="px-3 py-2 font-semibold">{s.columns.status}</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {enrollments.map((e) => (
                            <tr key={e.id}>
                              <td className="px-3 py-2.5 font-medium text-navy-900">{e.year ? pick(e.year.name_en, e.year.name_bn) : '—'}</td>
                              <td className="px-3 py-2.5">
                                {e.class ? pick(e.class.name_en, e.class.name_bn) : '—'}
                                {e.section && ` · ${e.section.name}`}
                              </td>
                              <td className="px-3 py-2.5">{e.roll_no ?? '—'}</td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={cx(
                                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                                    e.status === 'enrolled' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600',
                                  )}
                                >
                                  {s.enrollmentStatuses[e.status]}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                {canManage && e.status === 'enrolled' && (
                                  <button type="button" onClick={() => editEnrollment(e)} className={iconButton} aria-label={s.editEnrollment}>
                                    <Pencil className="h-4 w-4" aria-hidden />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>

                  <Panel
                    title={s.documents}
                    actions={
                      canManage && (
                        <button type="button" onClick={() => setUploading(true)} className={buttonClass('ghost', 'px-2 py-1')}>
                          <Upload className="h-4 w-4" aria-hidden />
                          {s.uploadDocument}
                        </button>
                      )
                    }
                  >
                    {st.documents.length === 0 ? (
                      <p className="text-sm text-slate-500">{t.admin.admissions.noDocuments}</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {st.documents.map((d) => (
                          <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                            <span className="flex min-w-0 items-center gap-3">
                              <FileText className="h-5 w-5 shrink-0 text-royal-600" aria-hidden />
                              <span className="min-w-0">
                                <span className="block font-medium text-navy-900">{d.title}</span>
                                <span className="block truncate text-xs text-slate-500">
                                  {d.file_name} · {(d.size_bytes / 1024).toFixed(0)} KB
                                  {d.bucket === 'admission-documents' && ` · ${s.fromAdmission}`}
                                </span>
                              </span>
                            </span>
                            <span className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!(await openPrivateFile(d.bucket, d.storage_path))) toast('error', t.common.errorBody);
                                }}
                                className={iconButton}
                                aria-label={`${t.admin.admissions.openDocument}: ${d.title}`}
                              >
                                <ExternalLink className="h-4 w-4" aria-hidden />
                              </button>
                              {canManage && d.bucket === STUDENT_BUCKET && (
                                <button
                                  type="button"
                                  className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                                  aria-label={`${t.admin.common.delete}: ${d.title}`}
                                  onClick={() =>
                                    setConfirm({
                                      title: t.admin.common.confirmDeleteTitle,
                                      body: `"${d.title}"`,
                                      label: t.admin.common.delete,
                                      danger: true,
                                      run: async () => {
                                        const { error } = await supabase!.from('student_documents').delete().eq('id', d.id);
                                        if (error) return t.admin.common.deleteFailed;
                                        await supabase!.storage.from(STUDENT_BUCKET).remove([d.storage_path]);
                                        return null;
                                      },
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                </button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 text-xs text-slate-500">{t.admin.admissions.linkNote}</p>
                  </Panel>
                </div>

                <div className="space-y-6">
                  <Panel
                    title={s.guardians}
                    actions={
                      canManage && (
                        <button type="button" onClick={() => linkGuardian(st)} className={buttonClass('ghost', 'px-2 py-1')}>
                          <Plus className="h-4 w-4" aria-hidden />
                          {s.linkGuardian}
                        </button>
                      )
                    }
                  >
                    {st.guardians.length === 0 ? (
                      <p className="text-sm text-slate-500">{t.admin.common.noRecords}</p>
                    ) : (
                      <ul className="space-y-3">
                        {st.guardians
                          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
                          .map((g) => (
                            <li key={g.guardian_id} className="rounded-xl border border-slate-200 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-semibold text-navy-900">{g.guardian?.name}</p>
                                  <p className="text-xs text-slate-500">
                                    {g.relationship}
                                    {g.is_primary && ` · ${s.primary}`}
                                  </p>
                                </div>
                                {g.verified_at ? (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                                    {s.verified}
                                  </span>
                                ) : (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-xs font-semibold text-gold-600">
                                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                                    {s.notVerified}
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-sm text-slate-700">{g.guardian?.phone}</p>
                              {g.guardian?.email && (
                                <p className="break-all text-sm text-slate-700">
                                  {g.guardian.email}
                                  {!g.guardian.email_notifications && <span className="ml-2 text-xs font-semibold text-gold-600">({s.emailsOff})</span>}
                                </p>
                              )}
                              {g.guardian?.user_id && <p className="mt-1 text-xs text-royal-700">{s.portalAccount} ✓</p>}
                              {canManage && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {g.guardian && (
                                    <button
                                      type="button"
                                      className={buttonClass('ghost', 'px-3 py-1.5 text-xs')}
                                      onClick={() => setAccountFor({ kind: 'guardian', recordId: g.guardian!.id, userId: g.guardian!.user_id })}
                                    >
                                      {t.admin.portalAccounts.title}
                                    </button>
                                  )}
                                  {g.guardian?.email && (
                                    <button
                                      type="button"
                                      className={buttonClass('ghost', 'px-3 py-1.5 text-xs')}
                                      onClick={() => {
                                        const enable = !g.guardian!.email_notifications;
                                        setConfirm({
                                          title: enable ? s.emailsOnTitle : s.emailsOffTitle,
                                          body: s.emailsBody,
                                          label: enable ? s.emailsOn : s.emailsOffAction,
                                          run: async () => {
                                            const { error } = await supabase!
                                              .from('guardians')
                                              .update({ email_notifications: enable })
                                              .eq('id', g.guardian!.id);
                                            return error ? studentError(t, error) : null;
                                          },
                                        });
                                      }}
                                    >
                                      {g.guardian.email_notifications ? s.emailsOffAction : s.emailsOn}
                                    </button>
                                  )}
                                  {!g.verified_at && (
                                    <button
                                      type="button"
                                      className={buttonClass('outline', 'px-3 py-1.5 text-xs')}
                                      onClick={() =>
                                        setConfirm({
                                          title: s.verifyTitle,
                                          body: s.verifyBody,
                                          label: s.verify,
                                          run: async () => {
                                            const { error } = await supabase!
                                              .from('student_guardians')
                                              .update({ verified_at: new Date().toISOString() })
                                              .eq('student_id', st.id)
                                              .eq('guardian_id', g.guardian_id);
                                            return error ? studentError(t, error) : null;
                                          },
                                        })
                                      }
                                    >
                                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                                      {s.verify}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={buttonClass('ghost', 'px-3 py-1.5 text-xs text-red-600 hover:bg-red-50')}
                                    onClick={() =>
                                      setConfirm({
                                        title: s.unlinkTitle,
                                        body: s.unlinkBody,
                                        label: s.unlink,
                                        danger: true,
                                        run: async () => {
                                          const { error } = await supabase!
                                            .from('student_guardians')
                                            .delete()
                                            .eq('student_id', st.id)
                                            .eq('guardian_id', g.guardian_id);
                                          return error ? studentError(t, error) : null;
                                        },
                                      })
                                    }
                                  >
                                    {s.unlink}
                                  </button>
                                </div>
                              )}
                            </li>
                          ))}
                      </ul>
                    )}
                  </Panel>

                  <Panel
                    title={t.admin.portalAccounts.title}
                    actions={
                      canManage && (
                        <button
                          type="button"
                          onClick={() => setAccountFor({ kind: 'student', recordId: st.id, userId: st.user_id })}
                          className={buttonClass('ghost', 'px-2 py-1')}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                          {t.admin.common.edit}
                        </button>
                      )
                    }
                  >
                    <p className="text-sm text-slate-700">{st.user_id ? `${t.admin.portalAccounts.linked} ✓` : t.admin.portalAccounts.none}</p>
                  </Panel>

                  {canSeeFees && <StudentFeesPanel studentId={st.id} />}

                  <Panel title={s.status}>
                    <div className="flex items-center justify-between gap-3">
                      <StudentStatusBadge status={st.status} />
                      {canManage && (
                        <button type="button" onClick={() => changeStatus(st)} className={buttonClass('outline', 'px-3 py-1.5')}>
                          {s.changeStatus}
                        </button>
                      )}
                    </div>
                    {st.status !== 'active' && (
                      <div className="mt-3">
                        <Detail
                          items={[
                            [s.fields.left_on, st.left_on && formatDate(st.left_on + 'T00:00:00')],
                            [s.fields.leave_reason, st.leave_reason],
                          ]}
                        />
                      </div>
                    )}
                  </Panel>
                </div>
              </div>

              <EnrollModal
                open={enrolling}
                student={st}
                onClose={() => setEnrolling(false)}
                onDone={() => {
                  setEnrolling(false);
                  toast('success', s.enrolled);
                  refresh();
                }}
              />
              {accountFor && (
                <PortalAccountModal
                  open
                  kind={accountFor.kind}
                  recordId={accountFor.recordId}
                  currentUserId={accountFor.userId}
                  onClose={() => setAccountFor(null)}
                  onDone={() => {
                    setAccountFor(null);
                    refresh();
                  }}
                />
              )}
              <UploadModal
                open={uploading}
                studentId={st.id}
                onClose={() => setUploading(false)}
                onDone={() => {
                  setUploading(false);
                  toast('success', t.admin.common.saved);
                  refresh();
                }}
              />
            </>
          )
        }
      </QueryView>

      <EntityModal
        open={modal !== null}
        title={modal?.title ?? ''}
        fields={modal?.fields ?? []}
        initial={modal?.initial ?? {}}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          const err = await modal!.save(v);
          if (!err) {
            setModal(null);
            toast('success', t.admin.common.saved);
            refresh();
          }
          return err;
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.label ?? ''}
        danger={confirm?.danger ?? false}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

/** Links (or unlinks) a portal login to a student or guardian record. */
function PortalAccountModal({
  kind,
  recordId,
  currentUserId,
  open,
  onClose,
  onDone,
}: {
  kind: 'student' | 'guardian';
  recordId: string;
  currentUserId: string | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLang();
  const pa = t.admin.portalAccounts;
  const toast = useToast();
  const [userId, setUserId] = useState(currentUserId ?? '');
  const [busy, setBusy] = useState(false);
  const table = kind === 'student' ? 'students' : 'guardians';
  const accounts = useQuery<{ id: string; full_name: string; email: string | null }[]>(
    (db) =>
      open
        ? db
            .from('user_profiles')
            .select('id,full_name,email,filter:role_assignments!inner(role,revoked_at)')
            .eq('filter.role', kind)
            .is('filter.revoked_at', null)
            .order('full_name')
        : Promise.resolve({ data: [], error: null }),
    [open, kind],
  );
  const taken = useQuery<{ user_id: string }[]>(
    (db) => (open ? db.from(table).select('user_id').not('user_id', 'is', null) : Promise.resolve({ data: [], error: null })),
    [open, table],
  );
  useEffect(() => setUserId(currentUserId ?? ''), [open, currentUserId]);
  const takenSet = new Set(taken.state.status === 'ready' ? taken.state.data.map((x) => x.user_id) : []);
  const options = (accounts.state.status === 'ready' ? accounts.state.data : []).filter((a) => a.id === currentUserId || !takenSet.has(a.id));

  const save = async (value: string | null) => {
    setBusy(true);
    const { error } = await supabase!.from(table).update({ user_id: value }).eq('id', recordId);
    setBusy(false);
    if (error) return toast('error', studentError(t, error));
    toast('success', pa.saved);
    onDone();
  };

  return (
    <Modal open={open} title={pa.link} onClose={onClose}>
      <div className="space-y-4">
        <SelectField
          label={pa.title}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          hint={kind === 'student' ? pa.studentHint : pa.guardianHint}
          options={[{ value: '', label: pa.select }, ...options.map((a) => ({ value: a.id, label: `${a.full_name || a.email} (${a.email})` }))]}
        />
        <div className="flex justify-between gap-3">
          {currentUserId ? (
            <button type="button" disabled={busy} onClick={() => save(null)} className={buttonClass('ghost', 'text-red-700 hover:bg-red-50')}>
              {pa.unlink}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={buttonClass('outline')}>
              {t.admin.common.cancel}
            </button>
            <button type="button" disabled={busy || !userId} onClick={() => save(userId)} className={buttonClass('primary')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t.admin.common.save}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EnrollModal({ open, student, onClose, onDone }: { open: boolean; student: StudentDetail; onClose: () => void; onDone: () => void }) {
  const { t, pick } = useLang();
  const s = t.admin.students;
  const years = useYears();
  const classes = useClasses();
  const [year, setYear] = useState('');
  const [cls, setCls] = useState('');
  const [section, setSection] = useState('');
  const [roll, setRoll] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sections = useSections(year, cls, student.medium);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!year || !cls) return setError(t.admin.common.required);
    setBusy(true);
    const { error: err } = await supabase!.rpc('enroll_student', {
      p_student: student.id,
      p_year: year,
      p_class: cls,
      p_section: section || null,
      p_roll: roll ? Number(roll) : null,
    });
    setBusy(false);
    if (err) return setError(studentError(t, err));
    onDone();
  };

  return (
    <Modal open={open} title={s.enroll} onClose={onClose}>
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={s.fields.year}
          required
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            setSection('');
          }}
          options={[{ value: '', label: t.apply.select }, ...(years.state.status === 'ready' ? years.state.data.map((y) => ({ value: y.id, label: pick(y.name_en, y.name_bn) })) : [])]}
        />
        <SelectField
          label={s.fields.class}
          required
          value={cls}
          onChange={(e) => {
            setCls(e.target.value);
            setSection('');
          }}
          options={[
            { value: '', label: t.apply.select },
            ...(classes.state.status === 'ready'
              ? classes.state.data
                  .filter((c) => c.class_streams.some((x) => x.medium === student.medium))
                  .map((c) => ({ value: c.id, label: pick(c.name_en, c.name_bn) }))
              : []),
          ]}
        />
        <SelectField
          label={s.fields.section}
          value={section}
          onChange={(e) => setSection(e.target.value)}
          options={[{ value: '', label: '—' }, ...(sections.state.status === 'ready' ? sections.state.data.map((x) => ({ value: x.id, label: x.name })) : [])]}
        />
        <TextField label={s.fields.roll_no} type="number" min={1} value={roll} onChange={(e) => setRoll(e.target.value)} />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className={buttonClass('outline')}>
            {t.admin.common.cancel}
          </button>
          <button type="submit" disabled={busy} className={buttonClass('primary')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {s.enroll}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UploadModal({ open, studentId, onClose, onDone }: { open: boolean; studentId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const s = t.admin.students;
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setFile(null);
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !file) return setError(t.admin.common.required);
    if (!DOCUMENT_TYPES.includes(file.type)) return setError(t.admin.upload.badType);
    if (file.size > MAX_UPLOAD_BYTES) return setError(t.admin.upload.tooLarge);
    setBusy(true);
    let path: string | null = null;
    try {
      path = await uploadPrivateFile(STUDENT_BUCKET, studentId, file);
      const { error: err } = await supabase!.from('student_documents').insert({
        student_id: studentId,
        title: title.trim().slice(0, 150),
        bucket: STUDENT_BUCKET,
        storage_path: path,
        file_name: file.name.slice(0, 200),
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (err) throw err;
      onDone();
    } catch {
      if (path) await supabase!.storage.from(STUDENT_BUCKET).remove([path]);
      setError(t.admin.upload.uploadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={s.uploadDocument} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label={s.documentTitle} required value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
        <input
          type="file"
          accept={DOCUMENT_TYPES.join(',')}
          aria-label={t.admin.upload.choose}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-royal-50 file:px-4 file:py-2 file:font-semibold file:text-royal-700"
        />
        <p className="text-xs text-slate-500">{t.apply.fileHint}</p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={buttonClass('outline')}>
            {t.admin.common.cancel}
          </button>
          <button type="submit" disabled={busy} className={buttonClass('primary')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {s.uploadDocument}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ====================================================================
// New student
// ====================================================================
export function NewStudentPage() {
  const { t, pick } = useLang();
  const s = t.admin.students;
  usePageMeta(s.addTitle, undefined, { noindex: true });
  const navigate = useNavigate();
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const years = useYears();
  const classes = useClasses();
  const [v, setV] = useState({
    name_en: '',
    name_bn: '',
    date_of_birth: '',
    gender: '' as Gender | '',
    admission_date: new Date().toISOString().slice(0, 10),
    previous_school: '',
    present_address: '',
    permanent_address: '',
    academic_year_id: '',
    medium: '' as Medium | '',
    class_id: '',
    section_id: '',
    roll_no: '',
    guardian_name: '',
    guardian_relationship: '',
    guardian_phone: '',
    guardian_email: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sections = useSections(v.academic_year_id, v.class_id, v.medium);

  useEffect(() => {
    if (!v.academic_year_id && years.state.status === 'ready' && years.state.data.length) {
      const current = years.state.data.find((y) => y.is_current) ?? years.state.data[0];
      setV((x) => ({ ...x, academic_year_id: current.id }));
    }
  }, [years.state, v.academic_year_id]);

  const set = (k: keyof typeof v, value: string) => {
    setV((x) => {
      const next = { ...x, [k]: value };
      if (k === 'medium') next.class_id = '';
      if (k === 'medium' || k === 'class_id' || k === 'academic_year_id') next.section_id = '';
      return next;
    });
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const classOptions =
    classes.state.status === 'ready' && v.medium
      ? classes.state.data.filter((c) => c.is_active && c.class_streams.some((x) => x.medium === v.medium))
      : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const req = t.admin.common.required;
    const errs: Record<string, string> = {};
    for (const k of ['name_en', 'date_of_birth', 'academic_year_id', 'medium', 'class_id', 'guardian_name', 'guardian_relationship'] as const) {
      if (!v[k].trim()) errs[k] = req;
    }
    if (!normalizeBdPhone(v.guardian_phone)) errs.guardian_phone = s.errors.INVALID_PHONE;
    if (v.guardian_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.guardian_email.trim())) errs.guardian_email = t.apply.errors.email;
    if (v.roll_no && !(Number.isInteger(Number(v.roll_no)) && Number(v.roll_no) > 0)) errs.roll_no = t.admin.academics.invalid;
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return setFormError(t.admin.common.fixErrors);

    setBusy(true);
    const { data, error } = await supabase!.rpc('create_student', { p: v });
    setBusy(false);
    if (error) return setFormError(studentError(t, error));
    toast('success', s.created);
    navigate(`/admin/students/${(data as { id: string }).id}`);
  };

  const field = (k: keyof typeof v, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField label={label} value={v[k]} error={errors[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
  );

  return (
    <>
      <Link to="/admin/students" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <AdminPageHeader title={s.addTitle} subtitle={s.addHelp} />
      {years.state.status === 'loading' || classes.state.status === 'loading' ? (
        <Spinner />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-6">
          <Panel title={s.addSections.student}>
            <div className="grid gap-5 md:grid-cols-2">
              {field('name_en', s.fields.name_en, { required: true, maxLength: 150 })}
              {field('name_bn', s.fields.name_bn, { maxLength: 150, lang: 'bn' })}
              {field('date_of_birth', s.fields.date_of_birth, { required: true, type: 'date' })}
              <SelectField
                label={s.fields.gender}
                value={v.gender}
                onChange={(e) => set('gender', e.target.value)}
                options={[{ value: '', label: t.apply.select }, ...GENDERS.map((g) => ({ value: g, label: t.genders[g] }))]}
              />
              {field('previous_school', s.fields.previous_school, { maxLength: 200 })}
              {field('admission_date', s.fields.admission_date, { type: 'date' })}
              <TextAreaField label={s.fields.present_address} rows={2} maxLength={500} value={v.present_address} onChange={(e) => set('present_address', e.target.value)} />
              <TextAreaField label={s.fields.permanent_address} rows={2} maxLength={500} value={v.permanent_address} onChange={(e) => set('permanent_address', e.target.value)} />
            </div>
          </Panel>
          <Panel title={s.addSections.enrollment}>
            <div className="grid gap-5 md:grid-cols-3">
              <SelectField
                label={s.fields.year}
                required
                error={errors.academic_year_id}
                value={v.academic_year_id}
                onChange={(e) => set('academic_year_id', e.target.value)}
                options={[{ value: '', label: t.apply.select }, ...(years.state.status === 'ready' ? years.state.data.map((y) => ({ value: y.id, label: pick(y.name_en, y.name_bn) })) : [])]}
              />
              <SelectField
                label={s.fields.medium}
                required
                hint={t.apply.mediumHint}
                error={errors.medium}
                value={v.medium}
                onChange={(e) => set('medium', e.target.value)}
                options={[{ value: '', label: t.apply.select }, ...MEDIUMS.map((m) => ({ value: m, label: mediumLabel(m) }))]}
              />
              <SelectField
                label={s.fields.class}
                required
                error={errors.class_id}
                value={v.class_id}
                disabled={!v.medium}
                onChange={(e) => set('class_id', e.target.value)}
                options={[{ value: '', label: v.medium ? t.apply.select : t.apply.selectMediumFirst }, ...classOptions.map((c) => ({ value: c.id, label: pick(c.name_en, c.name_bn) }))]}
              />
              <SelectField
                label={s.fields.section}
                value={v.section_id}
                onChange={(e) => set('section_id', e.target.value)}
                options={[{ value: '', label: '—' }, ...(sections.state.status === 'ready' ? sections.state.data.map((x) => ({ value: x.id, label: x.name })) : [])]}
              />
              {field('roll_no', s.fields.roll_no, { type: 'number', min: 1 })}
            </div>
          </Panel>
          <Panel title={s.addSections.guardian}>
            <div className="grid gap-5 md:grid-cols-2">
              {field('guardian_name', s.guardianName, { required: true, maxLength: 150 })}
              {field('guardian_relationship', s.relationship, { required: true, maxLength: 50 })}
              {field('guardian_phone', s.guardianPhone, { required: true, type: 'tel', maxLength: 20, hint: t.apply.phoneHint })}
              {field('guardian_email', s.guardianEmail, { type: 'email', maxLength: 254 })}
            </div>
          </Panel>
          {formError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Link to="/admin/students" className={buttonClass('outline')}>
              {t.admin.common.cancel}
            </Link>
            <button type="submit" disabled={busy} className={buttonClass('primary')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {s.add}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
