import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileText, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { useAuth } from '@/auth/AuthProvider';
import { ADMISSION_MANAGE_ROLES, hasAnyRole } from '@/auth/roles';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeSearch } from '@/lib/content';
import { openPrivateFile } from '@/lib/storage';
import {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  MEDIUMS,
  ageInYears,
  useSections,
  type AcademicYear,
  type AdmissionSettings,
  type ApplicationStatus,
  type DocumentType,
  type Gender,
  type Medium,
  type SchoolClass,
} from '@/lib/academics';
import { Pagination, QueryView, Spinner, buttonClass, cx, inputClass } from '@/components/ui';
import { AdminPageHeader, ConfirmDialog, InlineNotice, Panel, SelectField, TextAreaField, useToast } from '@/components/admin/adminUi';
import { EntityModal, entityErrorMessage, toEntityPayload, type EntityField, type EntityValues } from '@/components/admin/EntityModal';
import { ApplicationStatusBadge, useMediumLabel } from '@/components/admissions';
import { useActorNames } from './AuditPage';

const PAGE_SIZE = 25;
const DOC_BUCKET = 'admission-documents';

interface ApplicationRow {
  id: string;
  reference_no: string;
  student_name_en: string;
  student_name_bn: string | null;
  status: ApplicationStatus;
  submitted_at: string;
  medium: Medium;
  guardian_phone: string;
  class: { name_en: string; name_bn: string | null } | null;
}

// ====================================================================
export function ApplicationsListPage() {
  const { t, pick, formatDate } = useLang();
  const ad = t.admin.admissions;
  usePageMeta(ad.title, undefined, { noindex: true });
  const mediumLabel = useMediumLabel();
  const [params, setParams] = useSearchParams();
  const q = sanitizeSearch(params.get('q') ?? '');
  const year = params.get('year') ?? '';
  const cls = params.get('class') ?? '';
  const medium = (MEDIUMS as string[]).includes(params.get('medium') ?? '') ? (params.get('medium') as Medium) : '';
  const status = (APPLICATION_STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as ApplicationStatus) : '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draftQ, setDraftQ] = useState(q);

  const years = useQuery<AcademicYear[]>((db) => db.from('academic_years').select('*').order('starts_on', { ascending: false }), []);
  const classes = useQuery<SchoolClass[]>((db) => db.from('classes').select('*').order('level'), []);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const { state, retry } = useQuery<ApplicationRow[]>(
    (db) => {
      let query = db
        .from('admission_applications')
        .select('id,reference_no,student_name_en,student_name_bn,status,submitted_at,medium,guardian_phone,class:classes(name_en,name_bn)', {
          count: 'exact',
        });
      if (year) query = query.eq('academic_year_id', year);
      if (cls) query = query.eq('class_id', cls);
      if (medium) query = query.eq('medium', medium);
      if (status) query = query.eq('status', status);
      if (q) query = query.or(`student_name_en.ilike.*${q}*,student_name_bn.ilike.*${q}*,reference_no.ilike.*${q}*,guardian_phone.ilike.*${q}*`);
      const from = (page - 1) * PAGE_SIZE;
      return query.order('submitted_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    },
    [q, year, cls, medium, status, page],
  );

  const filterClass = inputClass + ' lg:w-auto';
  return (
    <>
      <AdminPageHeader title={ad.title} subtitle={ad.subtitle} />
      <Panel>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:flex">
          <form
            role="search"
            className="flex gap-2 sm:col-span-2 lg:flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ q: sanitizeSearch(draftQ) || null, page: null });
            }}
          >
            <label htmlFor="app-search" className="sr-only">
              {t.common.search}
            </label>
            <input id="app-search" type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder={ad.search} className={inputClass} maxLength={80} />
            <button type="submit" className={buttonClass('outline', 'px-3')} aria-label={t.common.search}>
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <select aria-label={t.admin.academics.fields.year} value={year} onChange={(e) => setParam({ year: e.target.value || null, page: null })} className={filterClass}>
            <option value="">{ad.allYears}</option>
            {years.state.status === 'ready' &&
              years.state.data.map((y) => (
                <option key={y.id} value={y.id}>
                  {pick(y.name_en, y.name_bn)}
                </option>
              ))}
          </select>
          <select aria-label={t.admin.academics.fields.class} value={cls} onChange={(e) => setParam({ class: e.target.value || null, page: null })} className={filterClass}>
            <option value="">{ad.allClasses}</option>
            {classes.state.status === 'ready' &&
              classes.state.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.name_en, c.name_bn)}
                </option>
              ))}
          </select>
          <select aria-label={t.admin.academics.fields.medium} value={medium} onChange={(e) => setParam({ medium: e.target.value || null, page: null })} className={filterClass}>
            <option value="">{ad.allMediums}</option>
            {MEDIUMS.map((m) => (
              <option key={m} value={m}>
                {mediumLabel(m)}
              </option>
            ))}
          </select>
          <select aria-label={t.admin.common.status} value={status} onChange={(e) => setParam({ status: e.target.value || null, page: null })} className={filterClass}>
            <option value="">{t.admin.common.allStatuses}</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.applicationStatuses[s]}
              </option>
            ))}
          </select>
        </div>
        <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
          {(rows, count) => (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">{ad.columns.reference}</th>
                      <th className="px-3 py-2 font-semibold">{ad.columns.student}</th>
                      <th className="px-3 py-2 font-semibold">{ad.columns.class}</th>
                      <th className="px-3 py-2 font-semibold">{ad.columns.submitted}</th>
                      <th className="px-3 py-2 font-semibold">{ad.columns.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
                          <Link to={r.id} className="font-semibold text-royal-700 hover:underline">
                            {r.reference_no}
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <Link to={r.id} className="font-medium text-navy-900 hover:text-royal-700">
                            {r.student_name_en}
                          </Link>
                          {r.student_name_bn && (
                            <span className="block text-xs text-slate-500" lang="bn">
                              {r.student_name_bn}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {r.class ? pick(r.class.name_en, r.class.name_bn) : '—'}
                          <span className="block text-xs text-slate-500">{mediumLabel(r.medium)}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDate(r.submitted_at, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="px-3 py-3">
                          <ApplicationStatusBadge status={r.status} />
                        </td>
                      </tr>
                    ))}
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
/** Converts an approved application into a student record (idempotent on the server). */
function AdmitPanel({ application, onAdmitted }: { application: ApplicationDetail; onAdmitted: () => void }) {
  const { t } = useLang();
  const ad = t.admin.admissions;
  const toast = useToast();
  const navigate = useNavigate();
  const sections = useSections(application.academic_year_id, application.class_id, application.medium);
  const existing = useQuery<{ id: string; student_code: string } | null>(
    (db) => db.from('students').select('id,student_code').eq('application_id', application.id).maybeSingle(),
    [application.id, application.status],
  );
  const [section, setSection] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);

  const student = existing.state.status === 'ready' ? existing.state.data : null;

  const admit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admit_applicant', {
      p_application_id: application.id,
      p_section_id: section || null,
      p_admission_date: date || null,
      p_guardian_verified: verified,
    });
    setBusy(false);
    if (error) return toast('error', t.admin.students.errors[error.message] ?? ad.errors.generic);
    toast('success', ad.admitted);
    onAdmitted();
    navigate(`/admin/students/${data}`);
  };

  return (
    <Panel title={ad.admit}>
      {student ? (
        <Link to={`/admin/students/${student.id}`} className={buttonClass('primary', 'w-full')}>
          {ad.viewStudent} ({student.student_code})
        </Link>
      ) : application.status === 'approved' ? (
        <form onSubmit={admit} className="space-y-4">
          <p className="text-sm text-slate-600">{ad.admitHelp}</p>
          <SelectField
            label={ad.section}
            value={section}
            onChange={(e) => setSection(e.target.value)}
            options={[{ value: '', label: '—' }, ...(sections.state.status === 'ready' ? sections.state.data.map((s) => ({ value: s.id, label: s.name })) : [])]}
          />
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-navy-800">{ad.admissionDate}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-start gap-2 text-sm text-navy-800">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-navy-300 text-royal-600" />
            <span>
              {ad.guardianVerified}
              <span className="mt-0.5 block text-xs text-slate-500">{ad.guardianVerifiedHelp}</span>
            </span>
          </label>
          <button type="submit" disabled={busy} className={buttonClass('gold', 'w-full')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {ad.admit}
          </button>
        </form>
      ) : existing.state.status === 'loading' ? (
        <Spinner />
      ) : null}
    </Panel>
  );
}

interface ApplicationDetail {
  id: string;
  reference_no: string;
  academic_year_id: string;
  class_id: string;
  medium: Medium;
  student_name_en: string;
  student_name_bn: string | null;
  date_of_birth: string;
  gender: Gender | null;
  previous_school: string | null;
  guardian_name: string;
  guardian_relationship: string;
  guardian_phone: string;
  guardian_email: string | null;
  present_address: string;
  permanent_address: string;
  status: ApplicationStatus;
  status_note: string | null;
  internal_notes: string | null;
  submitted_at: string;
  decided_at: string | null;
  class: { name_en: string; name_bn: string | null } | null;
  year: { name_en: string; name_bn: string | null } | null;
  documents: {
    id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    document_type: { name_en: string; name_bn: string | null } | null;
  }[];
  history: { id: number; from_status: ApplicationStatus | null; to_status: ApplicationStatus; note: string | null; changed_by: string | null; changed_at: string }[];
}

function Detail({ items }: { items: [string, string | null | undefined][] }) {
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

export function ApplicationDetailPage() {
  const { id = '' } = useParams();
  const { t, pick, formatDate } = useLang();
  const ad = t.admin.admissions;
  const f = t.apply.fields;
  usePageMeta(ad.title, undefined, { noindex: true });
  const { me } = useAuth();
  const canManage = hasAnyRole(me, ADMISSION_MANAGE_ROLES);
  const toast = useToast();
  const mediumLabel = useMediumLabel();
  const [reload, setReload] = useState(0);
  const [newStatus, setNewStatus] = useState<ApplicationStatus | ''>('');
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const { state, retry } = useQuery<ApplicationDetail | null>(
    (db) =>
      db
        .from('admission_applications')
        .select(
          '*,class:classes(name_en,name_bn),year:academic_years(name_en,name_bn),' +
            'documents:application_documents(id,file_name,mime_type,size_bytes,storage_path,document_type:admission_document_types(name_en,name_bn)),' +
            'history:admission_status_history(id,from_status,to_status,note,changed_by,changed_at)',
        )
        .eq('id', id)
        .maybeSingle(),
    [id, reload],
  );
  const app = state.status === 'ready' ? state.data : null;
  const names = useActorNames(app?.history.map((h) => h.changed_by).filter((x): x is string => Boolean(x)) ?? []);

  useEffect(() => {
    if (app) {
      setNotes(app.internal_notes ?? '');
      setNewStatus('');
      setNote('');
    }
  }, [app]);

  const openDocument = async (path: string) => {
    if (!(await openPrivateFile(DOC_BUCKET, path))) toast('error', t.common.errorBody);
  };

  const changeStatus = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !newStatus) return;
    if (newStatus === 'info_required' && !note.trim()) return toast('error', ad.errors.NOTE_REQUIRED);
    setBusy('status');
    const { error } = await supabase.rpc('change_application_status', { p_id: id, p_status: newStatus, p_note: note.trim() || null });
    setBusy(null);
    if (error) return toast('error', ad.errors[error.message] ?? ad.errors.generic);
    toast('success', ad.updated);
    setReload((n) => n + 1);
  };

  const saveNotes = async () => {
    if (!supabase) return;
    setBusy('notes');
    const { error } = await supabase.rpc('update_application_internal_notes', { p_id: id, p_notes: notes });
    setBusy(null);
    if (error) return toast('error', ad.errors.generic);
    toast('success', ad.notesSaved);
  };

  return (
    <>
      <Link to="/admin/admissions" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <QueryView state={state} retry={retry} empty={t.admin.common.noRecords} isEmpty={(d) => d === null}>
        {(a) =>
          a && (
            <>
              <AdminPageHeader
                title={a.student_name_en}
                subtitle={`${a.reference_no} · ${formatDate(a.submitted_at)}`}
                actions={<ApplicationStatusBadge status={a.status} large />}
              />
              {!canManage && (
                <div className="mb-4">
                  <InlineNotice>{ad.readOnly}</InlineNotice>
                </div>
              )}
              <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
                <div className="space-y-6">
                  <Panel title={ad.programme}>
                    <Detail
                      items={[
                        [f.academic_year, a.year ? pick(a.year.name_en, a.year.name_bn) : null],
                        [f.class, a.class ? pick(a.class.name_en, a.class.name_bn) : null],
                        [f.medium, mediumLabel(a.medium)],
                      ]}
                    />
                  </Panel>
                  <Panel title={ad.student}>
                    <Detail
                      items={[
                        [f.student_name_en, a.student_name_en],
                        [f.student_name_bn, a.student_name_bn],
                        [f.date_of_birth, `${formatDate(a.date_of_birth + 'T00:00:00')} (${ad.age(ageInYears(a.date_of_birth))})`],
                        [f.gender, a.gender ? t.genders[a.gender] : null],
                        [f.previous_school, a.previous_school],
                      ]}
                    />
                  </Panel>
                  <Panel title={ad.guardian}>
                    <Detail
                      items={[
                        [f.guardian_name, a.guardian_name],
                        [f.guardian_relationship, a.guardian_relationship],
                        [f.guardian_phone, a.guardian_phone],
                        [f.guardian_email, a.guardian_email],
                        [f.present_address, a.present_address],
                        [f.permanent_address, a.permanent_address],
                      ]}
                    />
                  </Panel>
                  <Panel title={ad.documents}>
                    {a.documents.length === 0 ? (
                      <p className="text-sm text-slate-500">{ad.noDocuments}</p>
                    ) : (
                      <>
                        <ul className="divide-y divide-slate-100">
                          {a.documents.map((d) => (
                            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                              <span className="flex min-w-0 items-center gap-3">
                                <FileText className="h-5 w-5 shrink-0 text-royal-600" aria-hidden />
                                <span className="min-w-0">
                                  <span className="block font-medium text-navy-900">
                                    {d.document_type ? pick(d.document_type.name_en, d.document_type.name_bn) : d.file_name}
                                  </span>
                                  <span className="block truncate text-xs text-slate-500">
                                    {d.file_name} · {(d.size_bytes / 1024).toFixed(0)} KB
                                  </span>
                                </span>
                              </span>
                              <button type="button" onClick={() => openDocument(d.storage_path)} className={buttonClass('outline', 'shrink-0 px-3 py-1.5')}>
                                <ExternalLink className="h-4 w-4" aria-hidden />
                                {ad.openDocument}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-3 text-xs text-slate-500">{ad.linkNote}</p>
                      </>
                    )}
                  </Panel>
                </div>

                <div className="space-y-6">
                  {canManage && (
                    <Panel title={ad.changeStatus}>
                      {APPLICATION_TRANSITIONS[a.status].length === 0 ? (
                        <p className="text-sm text-slate-500">{ad.noTransitions}</p>
                      ) : (
                        <form onSubmit={changeStatus} className="space-y-4">
                          <SelectField
                            label={ad.newStatus}
                            value={newStatus}
                            onChange={(e) => setNewStatus(e.target.value as ApplicationStatus | '')}
                            options={[
                              { value: '', label: t.apply.select },
                              ...APPLICATION_TRANSITIONS[a.status].map((s) => ({ value: s, label: t.applicationStatuses[s] })),
                            ]}
                          />
                          <TextAreaField
                            label={ad.noteToApplicant}
                            required={newStatus === 'info_required'}
                            rows={3}
                            maxLength={1000}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                          />
                          <button type="submit" disabled={!newStatus || busy !== null} className={buttonClass('primary', 'w-full')}>
                            {busy === 'status' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                            {ad.update}
                          </button>
                        </form>
                      )}
                    </Panel>
                  )}

                  {canManage && (a.status === 'approved' || a.status === 'admitted') && (
                    <AdmitPanel application={a} onAdmitted={() => setReload((n) => n + 1)} />
                  )}

                  {a.status_note && (
                    <Panel title={t.statusCheck.message}>
                      <p className="whitespace-pre-line text-sm text-navy-900">{a.status_note}</p>
                    </Panel>
                  )}

                  <Panel title={ad.history}>
                    <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
                      {[...a.history]
                        .sort((x, y) => x.changed_at.localeCompare(y.changed_at) || x.id - y.id)
                        .map((h) => (
                          <li key={h.id} className="relative">
                            <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-royal-600" aria-hidden />
                            <ApplicationStatusBadge status={h.to_status} />
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDate(h.changed_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              {h.changed_by && names[h.changed_by] && ` · ${names[h.changed_by]}`}
                            </p>
                            {h.note && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{h.note}</p>}
                          </li>
                        ))}
                    </ol>
                  </Panel>

                  <Panel title={ad.internalNotes}>
                    <TextAreaField
                      label={ad.internalNotes}
                      className="[&>label]:sr-only"
                      rows={5}
                      maxLength={4000}
                      value={notes}
                      disabled={!canManage}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    {canManage && (
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={saveNotes} disabled={busy !== null} className={buttonClass('outline')}>
                          {busy === 'notes' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                          {ad.saveNotes}
                        </button>
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            </>
          )
        }
      </QueryView>
    </>
  );
}

// ====================================================================
export function AdmissionSettingsPage() {
  const { t, pick } = useLang();
  const as = t.admin.admissionSettings;
  usePageMeta(as.title, undefined, { noindex: true });
  const toast = useToast();
  const [values, setValues] = useState<AdmissionSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<{ title: string; initial: EntityValues; id?: string } | null>(null);
  const [toDelete, setToDelete] = useState<DocumentType | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase
      ?.from('admission_settings')
      .select('is_open,require_gender,require_guardian_email,require_previous_school,instructions_en,instructions_bn,eligibility_en,eligibility_bn')
      .single()
      .then(({ data }) => data && setValues(data as AdmissionSettings));
  }, []);

  const docTypes = useQuery<DocumentType[]>((db) => db.from('admission_document_types').select('*').order('sort_order').order('name_en'), [reload]);

  const docFields: EntityField[] = [
    { name: 'code', label: t.admin.academics.fields.code, type: 'text', required: true, pattern: /^[a-z0-9-]{1,40}$/, hint: t.admin.academics.codeHint, maxLength: 40 },
    { name: 'sort_order', label: t.admin.fields.sort_order, type: 'number' },
    { name: 'name_en', label: t.admin.academics.fields.name_en, type: 'text', required: true, maxLength: 120 },
    { name: 'name_bn', label: t.admin.academics.fields.name_bn, type: 'text', maxLength: 120, lang: 'bn' },
    { name: 'description_en', label: as.description_en, type: 'textarea' },
    { name: 'description_bn', label: as.description_bn, type: 'textarea', lang: 'bn' },
    { name: 'is_required', label: as.required, type: 'checkbox' },
    { name: 'is_active', label: as.active, type: 'checkbox' },
  ];

  if (!values) return <Spinner />;

  const setText = (k: keyof AdmissionSettings, v: string) => setValues((x) => (x ? { ...x, [k]: v } : x));
  const setBool = (k: keyof AdmissionSettings, v: boolean) => setValues((x) => (x ? { ...x, [k]: v } : x));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const payload = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]),
    );
    const { error } = await supabase.from('admission_settings').update(payload).eq('id', true).select('id').single();
    setSaving(false);
    toast(error ? 'error' : 'success', error ? t.admin.common.saveFailed : t.admin.common.saved);
  };

  const checkboxes: [keyof AdmissionSettings, string][] = [
    ['is_open', as.isOpen],
    ['require_gender', as.requireGender],
    ['require_guardian_email', as.requireEmail],
    ['require_previous_school', as.requirePrevious],
  ];
  const texts: [keyof AdmissionSettings, string, 'bn' | undefined][] = [
    ['instructions_en', as.instructions_en, undefined],
    ['instructions_bn', as.instructions_bn, 'bn'],
    ['eligibility_en', as.eligibility_en, undefined],
    ['eligibility_bn', as.eligibility_bn, 'bn'],
  ];

  return (
    <>
      <AdminPageHeader title={as.title} subtitle={as.subtitle} />
      <div className="space-y-6">
        <form onSubmit={save}>
          <Panel title={as.formTitle}>
            <div className="mb-4">
              <InlineNotice>{as.openNote}</InlineNotice>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {checkboxes.map(([k, label]) => (
                <label key={k} className={cx('flex items-center gap-3 rounded-lg border p-3 text-sm font-medium', k === 'is_open' ? 'border-gold-300 bg-gold-100/40 sm:col-span-2' : 'border-slate-200')}>
                  <input
                    type="checkbox"
                    checked={Boolean(values[k])}
                    onChange={(e) => setBool(k, e.target.checked)}
                    className="h-4 w-4 rounded border-navy-300 text-royal-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {texts.map(([k, label, lang]) => (
                <TextAreaField key={k} label={label} lang={lang} rows={4} value={String(values[k] ?? '')} onChange={(e) => setText(k, e.target.value)} />
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="submit" disabled={saving} className={buttonClass('primary')}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t.admin.common.save}
              </button>
            </div>
          </Panel>
        </form>

        <Panel
          title={as.docTypes}
          actions={
            <button
              type="button"
              className={buttonClass('primary')}
              onClick={() =>
                setModal({
                  title: as.addDocType,
                  initial: { code: '', sort_order: '0', name_en: '', name_bn: '', description_en: '', description_bn: '', is_required: false, is_active: true },
                })
              }
            >
              <Plus className="h-4 w-4" aria-hidden />
              {as.addDocType}
            </button>
          }
        >
          <QueryView state={docTypes.state} retry={docTypes.retry} empty={t.admin.common.noRecords}>
            {(rows) => (
              <ul className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <li key={d.id} className={cx('flex items-center justify-between gap-3 py-3', !d.is_active && 'opacity-50')}>
                    <div className="min-w-0">
                      <p className="font-medium text-navy-900">
                        {pick(d.name_en, d.name_bn)}
                        {d.is_required && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{as.required}</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">{pick(d.description_en, d.description_bn)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        aria-label={`${t.admin.common.edit}: ${d.name_en}`}
                        className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700"
                        onClick={() =>
                          setModal({
                            title: `${t.admin.common.edit}: ${d.name_en}`,
                            id: d.id,
                            initial: {
                              code: d.code,
                              sort_order: String(d.sort_order),
                              name_en: d.name_en,
                              name_bn: d.name_bn ?? '',
                              description_en: d.description_en ?? '',
                              description_bn: d.description_bn ?? '',
                              is_required: d.is_required,
                              is_active: d.is_active,
                            },
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`${t.admin.common.delete}: ${d.name_en}`}
                        className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setToDelete(d)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </Panel>
      </div>

      <EntityModal
        open={modal !== null}
        title={modal?.title ?? ''}
        fields={docFields}
        initial={modal?.initial ?? {}}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          const payload = { ...toEntityPayload(docFields, v), sort_order: Number(v.sort_order) || 0 };
          const { error } = modal?.id
            ? await supabase!.from('admission_document_types').update(payload).eq('id', modal.id)
            : await supabase!.from('admission_document_types').insert(payload);
          if (error) return entityErrorMessage(error.code, t.admin.academics);
          setModal(null);
          toast('success', t.admin.common.saved);
          setReload((n) => n + 1);
          return null;
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={t.admin.common.confirmDeleteTitle}
        body={`"${toDelete?.name_en ?? ''}"`}
        confirmLabel={t.admin.common.delete}
        busy={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          setDeleting(true);
          const { error } = await supabase!.from('admission_document_types').delete().eq('id', toDelete!.id);
          setDeleting(false);
          setToDelete(null);
          if (error) toast('error', entityErrorMessage(error.code, t.admin.academics));
          else {
            toast('success', t.admin.common.deleted);
            setReload((n) => n + 1);
          }
        }}
      />
    </>
  );
}
