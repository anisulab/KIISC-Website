import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Globe, Loader2, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { normalizeBdPhone, type AcademicYear } from '@/lib/academics';
import { QueryView, buttonClass, cx } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, Modal, Panel, SelectField, useToast } from '@/components/admin/adminUi';
import { EntityModal, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { useMediumLabel } from '@/components/admissions';
import { attendanceError } from '@/components/attendance/AttendanceSheet';
import { sortSections, useYearSections } from './AttendanceAdminPages';

interface Teacher {
  id: string;
  staff_code: string;
  user_id: string | null;
  name_en: string;
  name_bn: string | null;
  designation_en: string | null;
  designation_bn: string | null;
  phone: string | null;
  email: string | null;
  joined_on: string | null;
  is_active: boolean;
  show_on_website: boolean;
  sort_order: number;
}

type TeacherWithCount = Teacher & { assignments: { id: string }[] };

/** Users holding the Teacher role, for linking a portal account. */
function useTeacherAccounts() {
  return useQuery<{ id: string; full_name: string; email: string | null }[]>(
    (db) =>
      db
        .from('user_profiles')
        .select('id,full_name,email,filter:role_assignments!inner(role,revoked_at)')
        .eq('filter.role', 'teacher')
        .is('filter.revoked_at', null)
        .order('full_name'),
    [],
  );
}

function useTeacherFields(currentUserId: string | null, linked: Set<string>) {
  const { t } = useLang();
  const tf = t.admin.teachers.fields;
  const accounts = useTeacherAccounts();
  const options = [
    { value: '', label: t.admin.teachers.noAccount },
    ...(accounts.state.status === 'ready'
      ? accounts.state.data
          .filter((a) => a.id === currentUserId || !linked.has(a.id))
          .map((a) => ({ value: a.id, label: `${a.full_name || a.email} (${a.email})` }))
      : []),
  ];
  const fields: EntityField[] = [
    { name: 'name_en', label: tf.name_en, type: 'text', required: true, maxLength: 150 },
    { name: 'name_bn', label: tf.name_bn, type: 'text', maxLength: 150, lang: 'bn' },
    { name: 'designation_en', label: tf.designation_en, type: 'text', maxLength: 100 },
    { name: 'designation_bn', label: tf.designation_bn, type: 'text', maxLength: 100, lang: 'bn' },
    { name: 'phone', label: tf.phone, type: 'text', maxLength: 20, pattern: /^(\+?88)?01[3-9]\d{8}$/, patternMessage: t.admin.students.errors.INVALID_PHONE },
    { name: 'email', label: tf.email, type: 'text', maxLength: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: t.apply.errors.email },
    { name: 'joined_on', label: tf.joined_on, type: 'date' },
    { name: 'sort_order', label: tf.sort_order, type: 'number' },
    { name: 'user_id', label: tf.user_id, type: 'select', options, hint: t.admin.teachers.accountHint, wide: true },
    { name: 'is_active', label: tf.is_active, type: 'checkbox' },
    { name: 'show_on_website', label: tf.show_on_website, type: 'checkbox' },
  ];
  return fields;
}

function toPayload(fields: EntityField[], v: EntityValues) {
  const payload = toEntityPayload(fields, v);
  if (payload.phone) payload.phone = normalizeBdPhone(String(payload.phone));
  if (payload.email) payload.email = String(payload.email).toLowerCase();
  payload.sort_order = Number(payload.sort_order) || 0;
  return payload;
}

function teacherInitial(t?: Teacher): EntityValues {
  return {
    name_en: t?.name_en ?? '',
    name_bn: t?.name_bn ?? '',
    designation_en: t?.designation_en ?? '',
    designation_bn: t?.designation_bn ?? '',
    phone: t?.phone ?? '',
    email: t?.email ?? '',
    joined_on: t?.joined_on ?? '',
    sort_order: String(t?.sort_order ?? 0),
    user_id: t?.user_id ?? '',
    is_active: t?.is_active ?? true,
    show_on_website: t?.show_on_website ?? false,
  };
}

// ====================================================================
export function TeachersListPage() {
  const { t, pick } = useLang();
  const tt = t.admin.teachers;
  usePageMeta(tt.title, undefined, { noindex: true });
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const { state, retry } = useQuery<TeacherWithCount[]>(
    (db) => db.from('teachers').select('*,assignments:teacher_assignments(id)').order('sort_order').order('name_en'),
    [reload],
  );
  const linked = new Set(state.status === 'ready' ? state.data.map((x) => x.user_id).filter((x): x is string => Boolean(x)) : []);
  const fields = useTeacherFields(null, linked);

  return (
    <>
      <AdminPageHeader
        title={tt.title}
        subtitle={tt.subtitle}
        actions={
          <button type="button" onClick={() => setAdding(true)} className={buttonClass('primary')}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {tt.add}
          </button>
        }
      />
      <Panel>
        <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
          {(rows) => (
            <div className="-mx-5 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{tt.fields.staff_code}</th>
                    <th className="px-3 py-2 font-semibold">{tt.fields.name_en.split(' (')[0]}</th>
                    <th className="px-3 py-2 font-semibold">{tt.fields.user_id}</th>
                    <th className="px-3 py-2 font-semibold">{tt.assignments}</th>
                    <th className="px-3 py-2 font-semibold">{t.admin.common.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className={cx('hover:bg-slate-50', !r.is_active && 'opacity-60')}>
                      <td className="px-3 py-3 font-mono text-xs">
                        <Link to={r.id} className="font-semibold text-royal-700 hover:underline">
                          {r.staff_code}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Link to={r.id} className="font-medium text-navy-900 hover:text-royal-700">
                          {pick(r.name_en, r.name_bn)}
                        </Link>
                        <span className="block text-xs text-slate-500">{pick(r.designation_en, r.designation_bn)}</span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{r.user_id ? '✓' : '—'}</td>
                      <td className="px-3 py-3">{r.assignments.length}</td>
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap gap-1">
                          {!r.is_active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{tt.inactive}</span>}
                          {r.show_on_website && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-royal-50 px-2 py-0.5 text-xs font-semibold text-royal-700">
                              <Globe className="h-3 w-3" aria-hidden />
                              {tt.onWebsite}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryView>
      </Panel>
      <EntityModal
        open={adding}
        title={tt.add}
        fields={fields}
        initial={teacherInitial()}
        onClose={() => setAdding(false)}
        onSubmit={async (v) => {
          const { error } = await supabase!.from('teachers').insert(toPayload(fields, v));
          if (error) return attendanceError(t, error);
          setAdding(false);
          toast('success', t.admin.common.saved);
          setReload((n) => n + 1);
          return null;
        }}
      />
    </>
  );
}

// ====================================================================
interface AssignmentRow {
  id: string;
  role: 'class_teacher' | 'subject_teacher';
  section: {
    name: string;
    medium: 'bangla_medium' | 'english_version';
    year: { name_en: string; name_bn: string | null; starts_on: string } | null;
    class: { name_en: string; name_bn: string | null; level: number } | null;
  } | null;
  subject: { name_en: string; name_bn: string | null } | null;
}

export function TeacherDetailPage() {
  const { id = '' } = useParams();
  const { t, pick } = useLang();
  const tt = t.admin.teachers;
  usePageMeta(tt.title, undefined, { noindex: true });
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [toRemove, setToRemove] = useState<AssignmentRow | null>(null);

  const teacher = useQuery<Teacher | null>((db) => db.from('teachers').select('*').eq('id', id).maybeSingle(), [id, reload]);
  const others = useQuery<{ user_id: string | null }[]>((db) => db.from('teachers').select('user_id').neq('id', id), [id]);
  const assignments = useQuery<AssignmentRow[]>(
    (db) =>
      db
        .from('teacher_assignments')
        .select('id,role,section:sections(name,medium,year:academic_years(name_en,name_bn,starts_on),class:classes(name_en,name_bn,level)),subject:subjects(name_en,name_bn)')
        .eq('teacher_id', id),
    [id, reload],
  );
  const linked = new Set(others.state.status === 'ready' ? others.state.data.map((x) => x.user_id).filter((x): x is string => Boolean(x)) : []);
  const tr = teacher.state.status === 'ready' ? teacher.state.data : null;
  const fields = useTeacherFields(tr?.user_id ?? null, linked);

  const sorted =
    assignments.state.status === 'ready'
      ? [...assignments.state.data].sort(
          (a, b) =>
            (b.section?.year?.starts_on ?? '').localeCompare(a.section?.year?.starts_on ?? '') ||
            (a.section?.class?.level ?? 0) - (b.section?.class?.level ?? 0),
        )
      : [];

  return (
    <>
      <Link to="/admin/teachers" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <QueryView state={teacher.state} retry={teacher.retry} empty={t.admin.common.noRecords} isEmpty={(d) => d === null}>
        {(tch) =>
          tch && (
            <>
              <AdminPageHeader
                title={pick(tch.name_en, tch.name_bn)}
                subtitle={`${tch.staff_code}${tch.designation_en ? ` · ${pick(tch.designation_en, tch.designation_bn)}` : ''}`}
                actions={
                  <button type="button" onClick={() => setEditing(true)} className={buttonClass('outline')}>
                    <Pencil className="h-4 w-4" aria-hidden />
                    {t.admin.common.edit}
                  </button>
                }
              />
              <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
                <Panel>
                  <dl className="divide-y divide-slate-100 text-sm">
                    {[
                      [tt.fields.phone, tch.phone],
                      [tt.fields.email, tch.email],
                      [tt.fields.joined_on, tch.joined_on],
                      [tt.fields.user_id, tch.user_id ? '✓' : tt.noAccount],
                      [tt.fields.is_active, tch.is_active ? t.admin.academics.yes : t.admin.academics.no],
                      [tt.onWebsite, tch.show_on_website ? t.admin.academics.yes : t.admin.academics.no],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4 py-2.5">
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="break-all text-right font-medium text-navy-900">{value || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </Panel>
                <Panel
                  title={tt.assignments}
                  actions={
                    tch.is_active && (
                      <button type="button" onClick={() => setAssigning(true)} className={buttonClass('ghost', 'px-2 py-1')}>
                        <Plus className="h-4 w-4" aria-hidden />
                        {tt.addAssignment}
                      </button>
                    )
                  }
                >
                  {sorted.length === 0 ? (
                    <p className="text-sm text-slate-500">{tt.noAssignments}</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {sorted.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                          <span className="min-w-0">
                            <span className="font-medium text-navy-900">
                              {a.section?.class ? pick(a.section.class.name_en, a.section.class.name_bn) : ''} · {a.section?.name}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {a.section?.year ? pick(a.section.year.name_en, a.section.year.name_bn) : ''} · {a.section && mediumLabel(a.section.medium)} ·{' '}
                              {tt.roles[a.role]}
                              {a.subject && `: ${pick(a.subject.name_en, a.subject.name_bn)}`}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setToRemove(a)}
                            className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                            aria-label={tt.removeAssignmentTitle}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              <EntityModal
                open={editing}
                title={t.admin.common.edit}
                fields={fields}
                initial={teacherInitial(tch)}
                onClose={() => setEditing(false)}
                onSubmit={async (v) => {
                  const { error } = await supabase!.from('teachers').update(toPayload(fields, v)).eq('id', tch.id);
                  if (error) return attendanceError(t, error);
                  setEditing(false);
                  toast('success', t.admin.common.saved);
                  setReload((n) => n + 1);
                  return null;
                }}
              />
              <AssignModal
                open={assigning}
                teacherId={tch.id}
                onClose={() => setAssigning(false)}
                onDone={() => {
                  setAssigning(false);
                  toast('success', t.admin.common.saved);
                  setReload((n) => n + 1);
                }}
              />
            </>
          )
        }
      </QueryView>
      <ConfirmDialog
        open={toRemove !== null}
        title={tt.removeAssignmentTitle}
        body={toRemove ? `${toRemove.section?.class?.name_en ?? ''} · ${toRemove.section?.name ?? ''} — ${tt.roles[toRemove.role]}` : ''}
        confirmLabel={t.admin.common.delete}
        onCancel={() => setToRemove(null)}
        onConfirm={async () => {
          const { error } = await supabase!.from('teacher_assignments').delete().eq('id', toRemove!.id);
          setToRemove(null);
          if (error) toast('error', attendanceError(t, error));
          else setReload((n) => n + 1);
        }}
      />
    </>
  );
}

function AssignModal({ open, teacherId, onClose, onDone }: { open: boolean; teacherId: string; onClose: () => void; onDone: () => void }) {
  const { t, pick } = useLang();
  const tt = t.admin.teachers;
  const mediumLabel = useMediumLabel();
  const years = useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
  const [yearId, setYearId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [role, setRole] = useState<'class_teacher' | 'subject_teacher'>('class_teacher');
  const [subjectId, setSubjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sections = useYearSections(yearId);
  const section = sections.state.status === 'ready' ? sections.state.data.find((s) => s.id === sectionId) : undefined;
  const subjects = useQuery<{ subject: { id: string; name_en: string; name_bn: string | null } | null }[]>(
    (db) =>
      section
        ? db.from('class_subjects').select('subject:subjects(id,name_en,name_bn)').eq('class_id', section.class_id).eq('medium', section.medium).order('sort_order')
        : Promise.resolve({ data: [], error: null }),
    [section?.id],
  );

  useEffect(() => {
    if (!open) return;
    setSectionId('');
    setSubjectId('');
    setRole('class_teacher');
    setError(null);
    if (years.state.status === 'ready' && years.state.data.length) {
      setYearId((years.state.data.find((y) => y.is_current) ?? years.state.data[0]).id);
    }
  }, [open, years.state]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!sectionId || (role === 'subject_teacher' && !subjectId)) return setError(t.admin.common.required);
    setBusy(true);
    const { error: err } = await supabase!.from('teacher_assignments').insert({
      teacher_id: teacherId,
      section_id: sectionId,
      role,
      subject_id: role === 'subject_teacher' ? subjectId : null,
    });
    setBusy(false);
    if (err) return setError(attendanceError(t, err));
    onDone();
  };

  return (
    <Modal open={open} title={tt.addAssignment} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField
          label={tt.year}
          value={yearId}
          onChange={(e) => {
            setYearId(e.target.value);
            setSectionId('');
          }}
          options={years.state.status === 'ready' ? years.state.data.map((y) => ({ value: y.id, label: pick(y.name_en, y.name_bn) })) : []}
        />
        <SelectField
          label={tt.section}
          required
          value={sectionId}
          onChange={(e) => {
            setSectionId(e.target.value);
            setSubjectId('');
          }}
          options={[
            { value: '', label: t.apply.select },
            ...(sections.state.status === 'ready'
              ? sortSections(sections.state.data).map((s) => ({
                  value: s.id,
                  label: `${s.class ? pick(s.class.name_en, s.class.name_bn) : ''} · ${s.name} (${mediumLabel(s.medium)})`,
                }))
              : []),
          ]}
        />
        <SelectField
          label={tt.role}
          value={role}
          onChange={(e) => setRole(e.target.value as 'class_teacher' | 'subject_teacher')}
          options={[
            { value: 'class_teacher', label: tt.roles.class_teacher },
            { value: 'subject_teacher', label: tt.roles.subject_teacher },
          ]}
        />
        {role === 'subject_teacher' && (
          <SelectField
            label={tt.subject}
            required
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            options={[
              { value: '', label: t.apply.select },
              ...(subjects.state.status === 'ready'
                ? subjects.state.data.filter((x) => x.subject).map((x) => ({ value: x.subject!.id, label: pick(x.subject!.name_en, x.subject!.name_bn) }))
                : []),
            ]}
          />
        )}
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
            {t.admin.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
