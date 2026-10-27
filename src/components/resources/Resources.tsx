import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, Link2, Loader2, Trash2 } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { supabase } from '@/integrations/supabase/client';
import { DOCUMENT_TYPES, openPrivateFile, uploadPrivateFile } from '@/lib/storage';
import type { Medium } from '@/lib/academics';
import { buttonClass, cx } from '@/components/ui';
import { ConfirmDialog, Modal, SelectField, TextAreaField, TextField, useToast } from '@/components/admin/adminUi';

export const RESOURCE_BUCKET = 'learning-resources';
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;

export interface LearningResource {
  id: string;
  academic_year_id: string;
  class_id: string;
  medium: Medium;
  section_id: string | null;
  subject_id: string | null;
  title_en: string;
  title_bn: string | null;
  description: string | null;
  file_path: string | null;
  file_name: string | null;
  external_url: string | null;
  is_published: boolean;
  uploaded_by: string | null;
  created_at: string;
  subject?: { name_en: string; name_bn: string | null } | null;
  class?: { name_en: string; name_bn: string | null } | null;
  section?: { name: string } | null;
}

export const RESOURCE_SELECT = '*,subject:subjects(name_en,name_bn),class:classes(name_en,name_bn),section:sections(name)';

export function ResourceList({
  resources,
  canDelete,
  onDeleted,
  showClass = false,
}: {
  resources: LearningResource[];
  canDelete?: (r: LearningResource) => boolean;
  onDeleted?: () => void;
  showClass?: boolean;
}) {
  const { t, pick, formatDate } = useLang();
  const r = t.admin.resources;
  const toast = useToast();
  const [toDelete, setToDelete] = useState<LearningResource | null>(null);

  const open = async (res: LearningResource) => {
    if (res.external_url) {
      window.open(res.external_url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (res.file_path && !(await openPrivateFile(RESOURCE_BUCKET, res.file_path))) toast('error', t.common.errorBody);
  };

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {resources.map((res) => (
          <li key={res.id} className={cx('flex items-start justify-between gap-3 py-3', !res.is_published && 'opacity-60')}>
            <div className="flex min-w-0 gap-3">
              {res.external_url ? <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" aria-hidden /> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" aria-hidden />}
              <div className="min-w-0">
                <p className="font-medium text-navy-900">
                  {pick(res.title_en, res.title_bn)}
                  {!res.is_published && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r.hidden}</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {[
                    showClass && res.class ? `${pick(res.class.name_en, res.class.name_bn)}${res.section ? ` · ${res.section.name}` : ''}` : null,
                    res.subject ? pick(res.subject.name_en, res.subject.name_bn) : null,
                    formatDate(res.created_at, { day: 'numeric', month: 'short', year: 'numeric' }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {res.description && <p className="mt-1 text-sm text-slate-600">{res.description}</p>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={() => open(res)} className={buttonClass('outline', 'px-3 py-1.5 text-xs')}>
                <ExternalLink className="h-4 w-4" aria-hidden />
                {r.open}
              </button>
              {canDelete?.(res) && (
                <button
                  type="button"
                  onClick={() => setToDelete(res)}
                  className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                  aria-label={`${t.admin.common.delete}: ${res.title_en}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={toDelete !== null}
        title={t.admin.common.confirmDeleteTitle}
        body={toDelete ? pick(toDelete.title_en, toDelete.title_bn) : ''}
        confirmLabel={t.admin.common.delete}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const res = toDelete!;
          const { error } = await supabase!.from('learning_resources').delete().eq('id', res.id);
          setToDelete(null);
          if (error) return toast('error', t.admin.common.deleteFailed);
          if (res.file_path) await supabase!.storage.from(RESOURCE_BUCKET).remove([res.file_path]);
          toast('success', t.admin.common.deleted);
          onDeleted?.();
        }}
      />
    </>
  );
}

export interface ResourceTarget {
  value: string; // section id, or "class:<classId>:<medium>" for a whole class
  label: string;
  yearId: string;
  classId: string;
  medium: Medium;
  sectionId: string | null;
}

/** Add a file or link for one of the allowed targets (admins: classes or sections; teachers: their sections). */
export function AddResourceModal({ open, targets, onClose, onDone }: { open: boolean; targets: ResourceTarget[]; onClose: () => void; onDone: () => void }) {
  const { t, pick } = useLang();
  const r = t.admin.resources;
  const [target, setTarget] = useState('');
  const [subjects, setSubjects] = useState<{ value: string; label: string }[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [titleEn, setTitleEn] = useState('');
  const [titleBn, setTitleBn] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [published, setPublished] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = targets.find((x) => x.value === target);

  useEffect(() => {
    if (!open) return;
    setTarget(targets[0]?.value ?? '');
    setSubjectId('');
    setKind('file');
    setTitleEn('');
    setTitleBn('');
    setDescription('');
    setUrl('');
    setFile(null);
    setPublished(true);
    setError(null);
  }, [open, targets]);

  useEffect(() => {
    if (!chosen || !supabase) return setSubjects([]);
    supabase
      .from('class_subjects')
      .select('subject:subjects(id,name_en,name_bn)')
      .eq('class_id', chosen.classId)
      .eq('medium', chosen.medium)
      .order('sort_order')
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as { subject: { id: string; name_en: string; name_bn: string | null } | null }[];
        setSubjects(rows.filter((x) => x.subject).map((x) => ({ value: x.subject!.id, label: pick(x.subject!.name_en, x.subject!.name_bn) })));
      });
  }, [chosen, pick]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!chosen || titleEn.trim().length < 2) return setError(t.admin.common.required);
    if (kind === 'link' && !/^https:\/\/\S+$/.test(url.trim())) return setError(r.badLink);
    if (kind === 'file') {
      if (!file) return setError(t.admin.common.required);
      if (!DOCUMENT_TYPES.includes(file.type)) return setError(t.admin.upload.badType);
      if (file.size > MAX_RESOURCE_BYTES) return setError(r.tooLarge);
    }
    setBusy(true);
    let path: string | null = null;
    try {
      if (kind === 'file' && file) {
        // Teachers upload into their section's folder (checked by storage policy).
        path = await uploadPrivateFile(RESOURCE_BUCKET, chosen.sectionId ?? `class-${chosen.classId}`, file);
      }
      const { error: err } = await supabase!.from('learning_resources').insert({
        academic_year_id: chosen.yearId,
        class_id: chosen.classId,
        medium: chosen.medium,
        section_id: chosen.sectionId,
        subject_id: subjectId || null,
        title_en: titleEn.trim(),
        title_bn: titleBn.trim() || null,
        description: description.trim() || null,
        file_path: path,
        file_name: file && kind === 'file' ? file.name.slice(0, 200) : null,
        mime_type: file && kind === 'file' ? file.type : null,
        size_bytes: file && kind === 'file' ? file.size : null,
        external_url: kind === 'link' ? url.trim() : null,
        is_published: published,
      });
      if (err) throw err;
      onDone();
    } catch {
      if (path) await supabase!.storage.from(RESOURCE_BUCKET).remove([path]);
      setError(t.admin.common.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={r.add} onClose={() => !busy && onClose()}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <SelectField label={r.fields.class} required value={target} onChange={(e) => setTarget(e.target.value)} options={targets.map((x) => ({ value: x.value, label: x.label }))} />
        <SelectField label={r.fields.subject} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} options={[{ value: '', label: r.fields.anySubject }, ...subjects]} />
        <TextField label={r.fields.title_en} required maxLength={150} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
        <TextField label={r.fields.title_bn} lang="bn" maxLength={150} value={titleBn} onChange={(e) => setTitleBn(e.target.value)} />
        <TextAreaField label={r.fields.description} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="flex gap-2" role="radiogroup" aria-label={r.fields.kind}>
          {(['file', 'link'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cx('rounded-lg border px-4 py-2 text-sm font-semibold', kind === k ? 'border-royal-500 bg-royal-50 text-royal-700' : 'border-slate-200 text-slate-600')}
            >
              {r.kinds[k]}
            </button>
          ))}
        </div>
        {kind === 'file' ? (
          <label className="block text-sm font-semibold text-navy-800">
            {r.fields.file}
            <input
              type="file"
              accept={DOCUMENT_TYPES.join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-royal-50 file:px-4 file:py-2 file:font-semibold file:text-royal-700"
            />
          </label>
        ) : (
          <TextField label={r.fields.link} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        )}
        <label className="flex items-center gap-2 text-sm text-navy-800">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="h-4 w-4 rounded border-navy-300 text-royal-600" />
          {r.fields.published}
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass('outline')}>
            {t.admin.common.cancel}
          </button>
          <button type="submit" disabled={busy || targets.length === 0} className={buttonClass('primary')}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {r.add}
          </button>
        </div>
      </form>
    </Modal>
  );
}
