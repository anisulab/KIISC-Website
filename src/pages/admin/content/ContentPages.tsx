import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileText, Loader2, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { publicAssetUrl, sanitizeSearch } from '@/lib/content';
import { checkFile, removePublicFile, uploadPublicFile } from '@/lib/storage';
import { EmptyState, Pagination, QueryView, Spinner, buttonClass, cx, inputClass } from '@/components/ui';
import {
  AdminPageHeader,
  ConfirmDialog,
  FieldShell,
  InlineNotice,
  Panel,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
  isoToLocalInput,
  localInputToIso,
  useToast,
} from '@/components/admin/adminUi';
import { CONTENT_CONFIGS, TITLE_REQUIRED, type ContentConfig, type ContentKind, type FieldDef } from './config';

const PAGE_SIZE = 20;
type Row = Record<string, unknown> & { id: string; title_en: string | null; title_bn: string | null; status: 'draft' | 'published' | 'archived' };

// ====================================================================
// List
// ====================================================================
export function ContentListPage({ kind }: { kind: ContentKind }) {
  const cfg = CONTENT_CONFIGS[kind];
  const { t, pick, formatDate } = useLang();
  const labels = t.admin.content[kind];
  usePageMeta(labels.title, undefined, { noindex: true });
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const q = sanitizeSearch(params.get('q') ?? '');
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draftQ, setDraftQ] = useState(q);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reload, setReload] = useState(0);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const { state, retry } = useQuery<Row[]>(
    (db) => {
      let query = db.from(cfg.table).select(`id,title_en,title_bn,status,${cfg.listColumns}`, { count: 'exact' });
      if (status) query = query.eq('status', status);
      if (type && cfg.typeFilter) query = query.eq(cfg.typeFilter.column, type);
      if (q) query = query.or(`title_en.ilike.*${q}*,title_bn.ilike.*${q}*`);
      for (const o of cfg.order) query = query.order(o.column, { ascending: o.ascending });
      const from = (page - 1) * PAGE_SIZE;
      return query.range(from, from + PAGE_SIZE - 1);
    },
    [kind, q, status, type, page, reload],
  );

  const fileFields = cfg.fields.filter((f) => f.type === 'file').map((f) => f.name);

  const doDelete = async () => {
    if (!toDelete || !supabase) return;
    setDeleting(true);
    const { data, error } = await supabase
      .from(cfg.table)
      .delete()
      .eq('id', toDelete.id)
      .select(['id', ...fileFields].join(','));
    setDeleting(false);
    if (error || !data?.length) {
      toast('error', t.admin.common.deleteFailed);
      return;
    }
    // Remove the stored files only after the row is gone.
    const deleted = data[0] as unknown as Record<string, string | null>;
    await Promise.all(fileFields.map((f) => removePublicFile(deleted[f])));
    setToDelete(null);
    toast('success', t.admin.common.deleted);
    setReload((n) => n + 1);
  };

  return (
    <>
      <AdminPageHeader
        title={labels.title}
        actions={
          <Link to="new" className={buttonClass('primary')}>
            <Plus className="h-4 w-4" aria-hidden />
            {labels.newTitle}
          </Link>
        }
      />
      <Panel>
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <form
            role="search"
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ q: sanitizeSearch(draftQ) || null, page: null });
            }}
          >
            <label htmlFor="content-search" className="sr-only">
              {t.common.search}
            </label>
            <input
              id="content-search"
              type="search"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder={t.common.searchPlaceholder}
              className={inputClass}
              maxLength={80}
            />
            <button type="submit" className={buttonClass('outline', 'px-3')} aria-label={t.common.search}>
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <select
            aria-label={t.admin.common.status}
            value={status}
            onChange={(e) => setParam({ status: e.target.value || null, page: null })}
            className={inputClass + ' md:w-44'}
          >
            <option value="">{t.admin.common.allStatuses}</option>
            {(['draft', 'published', 'archived'] as const).map((s) => (
              <option key={s} value={s}>
                {t.admin.statuses[s]}
              </option>
            ))}
          </select>
          {cfg.typeFilter && (
            <select
              aria-label={t.admin.fields.category}
              value={type}
              onChange={(e) => setParam({ type: e.target.value || null, page: null })}
              className={inputClass + ' md:w-48'}
            >
              <option value="">{t.common.allCategories}</option>
              {cfg.typeFilter.options(t).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <QueryView state={state} retry={retry} empty={t.admin.common.noRecords}>
          {(rows, count) => (
            <>
              <div className="-mx-5 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      {cfg.thumbnailColumn && <th className="w-20 px-3 py-2" />}
                      <th className="px-3 py-2 font-semibold">{t.admin.fields.title_en.split(' (')[0]}</th>
                      {cfg.typeFilter && <th className="px-3 py-2 font-semibold">{t.admin.fields.category}</th>}
                      <th className="px-3 py-2 font-semibold">{t.admin.common.status}</th>
                      <th className="px-3 py-2 font-semibold">{t.admin.fields[cfg.dateColumn as 'publish_at'] ?? t.admin.common.updated}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t.admin.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const typeValue = cfg.typeFilter ? String(r[cfg.typeFilter.column] ?? '') : '';
                      const dateValue = r[cfg.dateColumn] as string | null;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          {cfg.thumbnailColumn && (
                            <td className="px-3 py-2">
                              {supabase && r[cfg.thumbnailColumn] ? (
                                <img
                                  src={publicAssetUrl(supabase, String(r[cfg.thumbnailColumn]))}
                                  alt=""
                                  loading="lazy"
                                  className="h-12 w-16 rounded-md object-cover"
                                />
                              ) : null}
                            </td>
                          )}
                          <td className="max-w-xs px-3 py-3">
                            <Link to={r.id} className="font-medium text-navy-900 hover:text-royal-700">
                              {pick(r.title_en, r.title_bn) || t.admin.common.untitled}
                            </Link>
                          </td>
                          {cfg.typeFilter && (
                            <td className="px-3 py-3 text-slate-600">
                              {cfg.typeFilter.options(t).find((o) => o.value === typeValue)?.label ?? typeValue}
                            </td>
                          )}
                          <td className="px-3 py-3">
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                            {dateValue
                              ? formatDate(
                                  cfg.dateIsTimestamp ? dateValue : `${dateValue}T00:00:00`,
                                  cfg.dateIsTimestamp
                                    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
                                    : { day: 'numeric', month: 'short', year: 'numeric' },
                                )
                              : '—'}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-1">
                              <Link to={r.id} className="rounded-md p-2 text-slate-600 hover:bg-royal-50 hover:text-royal-700" aria-label={`${t.admin.common.edit}: ${pick(r.title_en, r.title_bn)}`}>
                                <Pencil className="h-4 w-4" aria-hidden />
                              </Link>
                              <button
                                type="button"
                                onClick={() => setToDelete(r)}
                                className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                                aria-label={`${t.admin.common.delete}: ${pick(r.title_en, r.title_bn)}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
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

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={t.admin.common.confirmDeleteTitle}
        body={`${toDelete ? `"${pick(toDelete.title_en, toDelete.title_bn) || t.admin.common.untitled}": ` : ''}${t.admin.common.confirmDeleteBody}`}
        confirmLabel={t.admin.common.delete}
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}

// ====================================================================
// Editor
// ====================================================================
type FormValues = Record<string, string>;
type PendingFile = File | 'remove' | undefined;

function toFormValues(cfg: ContentConfig, source: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  for (const f of cfg.fields) {
    const v = source[f.name];
    if (f.type === 'datetime') out[f.name] = isoToLocalInput(v as string | null);
    else out[f.name] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

function toPayload(cfg: ContentConfig, values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of cfg.fields) {
    if (f.type === 'file') continue;
    const raw = (values[f.name] ?? '').trim();
    if (f.type === 'datetime') out[f.name] = localInputToIso(raw);
    else if (f.type === 'number') out[f.name] = raw === '' ? 0 : Number(raw);
    else out[f.name] = raw === '' ? null : raw;
  }
  return out;
}

export function ContentEditPage({ kind }: { kind: ContentKind }) {
  const cfg = CONTENT_CONFIGS[kind];
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const { t, pick } = useLang();
  const labels = t.admin.content[kind];
  usePageMeta(isNew ? labels.newTitle : labels.editTitle, undefined, { noindex: true });
  const navigate = useNavigate();
  const toast = useToast();

  const [values, setValues] = useState<FormValues | null>(isNew ? toFormValues(cfg, cfg.defaults()) : null);
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [files, setFiles] = useState<Record<string, PendingFile>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (isNew || !supabase) return;
    supabase
      .from(cfg.table)
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return setLoadError(true);
        setOriginal(data);
        setValues(toFormValues(cfg, data));
      });
  }, [cfg, id, isNew]);

  const set = (name: string, value: string) => {
    setValues((v) => (v ? { ...v, [name]: value } : v));
    setErrors((e) => {
      const { [name]: _, ...rest } = e;
      return rest;
    });
  };

  const validate = (v: FormValues): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const f of cfg.fields) {
      const value = (v[f.name] ?? '').trim();
      if (f.type === 'file') {
        const pending = files[f.name];
        const hasFile = pending instanceof File || (pending !== 'remove' && Boolean(original?.[f.name]));
        if (f.required && !hasFile) errs[f.name] = t.admin.common.required;
        continue;
      }
      if (f.required && !value) errs[f.name] = t.admin.common.required;
      if ((f.type === 'text' || f.type === 'textarea') && f.maxLength && value.length > f.maxLength) {
        errs[f.name] = t.admin.common.tooLong(f.maxLength);
      }
    }
    if (TITLE_REQUIRED.includes(kind) && !v.title_en?.trim() && !v.title_bn?.trim()) {
      errs.title_en = t.admin.common.titleRequired;
    }
    if (v.ends_on && v.starts_on && v.ends_on < v.starts_on) errs.ends_on = t.admin.common.endBeforeStart;
    if (v.expires_at && v.publish_at && new Date(v.expires_at) <= new Date(v.publish_at)) {
      errs.expires_at = t.admin.common.endBeforeStart;
    }
    return errs;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!values || !supabase) return;
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast('error', t.admin.common.fixErrors);
      return;
    }
    setSaving(true);
    const payload = toPayload(cfg, values);
    const uploaded: string[] = [];
    const replaced: string[] = [];
    try {
      for (const f of cfg.fields) {
        if (f.type !== 'file') continue;
        const pending = files[f.name];
        const previous = (original?.[f.name] as string | null) ?? null;
        if (pending instanceof File) {
          const path = await uploadPublicFile(f.folder, pending);
          uploaded.push(path);
          payload[f.name] = path;
          if (previous) replaced.push(previous);
        } else if (pending === 'remove') {
          payload[f.name] = null;
          if (previous) replaced.push(previous);
        }
      }
    } catch {
      await Promise.all(uploaded.map((p) => removePublicFile(p)));
      setSaving(false);
      toast('error', t.admin.upload.uploadFailed);
      return;
    }

    const result = isNew
      ? await supabase.from(cfg.table).insert(payload).select('id').single()
      : await supabase.from(cfg.table).update(payload).eq('id', id).select('id').single();
    setSaving(false);

    if (result.error) {
      await Promise.all(uploaded.map((p) => removePublicFile(p)));
      toast('error', t.admin.common.saveFailed);
      return;
    }
    await Promise.all(replaced.map((p) => removePublicFile(p)));
    toast('success', t.admin.common.saved);
    navigate(`/admin/content/${kind}`);
  };

  if (loadError) return <EmptyState message={t.admin.common.noRecords} />;
  if (!values) return <Spinner />;

  const wasPublished = original?.status === 'published';
  const hasFileField = cfg.fields.some((f) => f.type === 'file');

  return (
    <>
      <Link to={`/admin/content/${kind}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.admin.common.backToList}
      </Link>
      <AdminPageHeader
        title={isNew ? labels.newTitle : labels.editTitle}
        subtitle={!isNew && original ? pick(original.title_en as string, original.title_bn as string) : undefined}
        actions={
          !isNew && wasPublished && cfg.publicPath ? (
            <a href={cfg.publicPath(id!)} target="_blank" rel="noopener noreferrer" className={buttonClass('outline')}>
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t.admin.common.viewOnSite}
            </a>
          ) : undefined
        }
      />
      <form onSubmit={onSubmit} noValidate>
        <Panel>
          {hasFileField && (
            <div className="mb-5">
              <InlineNotice tone="warning">{t.admin.upload.publicWarning}</InlineNotice>
            </div>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            {cfg.fields.map((f) => (
              <FieldInput
                key={f.name}
                field={f}
                value={values[f.name] ?? ''}
                error={errors[f.name]}
                onChange={(v) => set(f.name, v)}
                currentPath={(original?.[f.name] as string | null) ?? null}
                pending={files[f.name]}
                onFile={(p) => {
                  setFiles((x) => ({ ...x, [f.name]: p }));
                  setErrors((e) => {
                    const { [f.name]: _, ...rest } = e;
                    return rest;
                  });
                }}
              />
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5">
            <Link to={`/admin/content/${kind}`} className={buttonClass('outline')}>
              {t.admin.common.cancel}
            </Link>
            <button type="submit" disabled={saving} className={buttonClass('primary')}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {saving ? t.admin.common.saving : t.admin.common.save}
            </button>
          </div>
        </Panel>
      </form>
    </>
  );
}

function FieldInput({
  field,
  value,
  error,
  onChange,
  currentPath,
  pending,
  onFile,
}: {
  field: FieldDef;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  currentPath: string | null;
  pending: PendingFile;
  onFile: (p: PendingFile) => void;
}) {
  const { t } = useLang();
  const label = t.admin.fields[field.name];
  const wide = field.wide ? 'md:col-span-2' : undefined;
  const isBn = field.name.endsWith('_bn');
  const common = { label, error, required: field.required, className: wide, lang: isBn ? 'bn' : undefined };

  switch (field.type) {
    case 'text':
      return <TextField {...common} value={value} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />;
    case 'textarea':
      return <TextAreaField {...common} rows={8} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return <SelectField {...common} value={value} options={field.options(t)} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <TextField {...common} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <TextField {...common} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <TextField {...common} type="number" step={1} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'file':
      return (
        <FileInput
          label={label}
          error={error}
          required={field.required}
          className={wide}
          accept={field.accept}
          currentPath={pending === 'remove' ? null : currentPath}
          pending={pending}
          onFile={onFile}
        />
      );
  }
}

export function FileInput({
  label,
  error,
  required,
  className,
  accept,
  currentPath,
  pending,
  onFile,
}: {
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
  accept: string[];
  currentPath: string | null;
  pending: PendingFile;
  onFile: (p: PendingFile) => void;
}) {
  const { t } = useLang();
  const [localError, setLocalError] = useState<string | null>(null);
  const previewUrl = useMemo(
    () => (pending instanceof File && pending.type.startsWith('image/') ? URL.createObjectURL(pending) : null),
    [pending],
  );
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const currentUrl = currentPath && supabase ? publicAssetUrl(supabase, currentPath) : null;
  const shownImage = previewUrl ?? (currentUrl && !currentPath!.endsWith('.pdf') ? currentUrl : null);

  return (
    <FieldShell label={label} error={localError ?? error} required={required} className={className}>
      {(id, describedBy) => (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {shownImage ? (
            <img src={shownImage} alt="" className="h-24 w-32 rounded-lg border border-slate-200 object-cover" />
          ) : pending instanceof File || currentPath ? (
            <div className="flex h-24 w-32 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              <FileText className="h-8 w-8 text-slate-400" aria-hidden />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={id} className={cx(buttonClass('outline'), 'cursor-pointer')}>
              <Upload className="h-4 w-4" aria-hidden />
              {t.admin.upload.choose}
            </label>
            <input
              id={id}
              type="file"
              accept={accept.join(',')}
              aria-describedby={describedBy}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const problem = checkFile(file, accept);
                if (problem) {
                  setLocalError(t.admin.upload[problem]);
                  return;
                }
                setLocalError(null);
                onFile(file);
              }}
            />
            {(pending instanceof File || currentPath) && (
              <button type="button" onClick={() => onFile(currentPath && !(pending instanceof File) ? 'remove' : undefined)} className={buttonClass('ghost', 'text-red-600 hover:bg-red-50')}>
                <X className="h-4 w-4" aria-hidden />
                {t.admin.upload.remove}
              </button>
            )}
            {pending instanceof File ? (
              <span className="text-xs text-slate-500">{pending.name}</span>
            ) : currentUrl ? (
              <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-royal-700 hover:underline">
                {t.admin.upload.current}
              </a>
            ) : null}
          </div>
        </div>
      )}
    </FieldShell>
  );
}
