import { useEffect, useState } from 'react';
import { Download, FileText, Lock, X } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import { type GalleryItem, type Notice, type PublicDocument, nowIso, publicAssetUrl } from '@/lib/content';
import { Card, PageHeader, Placeholder, QueryView, Section, SectionHeading, buttonClass } from '@/components/ui';
import { NoticeRow } from '@/components/content';

export function GalleryPage() {
  const { t, pick } = useLang();
  usePageMeta(t.gallery.title, t.gallery.subtitle);
  const [open, setOpen] = useState<GalleryItem | null>(null);

  const { state, retry } = useQuery<GalleryItem[]>(
    (db) =>
      db
        .from('gallery_items')
        .select('id,title_en,title_bn,image_path,album')
        .eq('status', 'published')
        .order('sort_order')
        .order('created_at', { ascending: false })
        .limit(60),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <PageHeader title={t.gallery.title} subtitle={t.gallery.subtitle} />
      <Section>
        <QueryView state={state} retry={retry} empty={t.common.emptyGallery}>
          {(rows) => (
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {rows.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(g)}
                    className="group block aspect-[4/3] w-full overflow-hidden rounded-xl bg-navy-50"
                  >
                    <img
                      src={publicAssetUrl(supabase!, g.image_path)}
                      alt={pick(g.title_en, g.title_bn)}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Section>
      {open && supabase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pick(open.title_en, open.title_bn)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/90 p-4"
          onClick={() => setOpen(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label={t.common.close}
            onClick={() => setOpen(null)}
            autoFocus
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
          <figure className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={publicAssetUrl(supabase, open.image_path)}
              alt={pick(open.title_en, open.title_bn)}
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />
            {pick(open.title_en, open.title_bn) && (
              <figcaption className="mt-3 text-center text-white">{pick(open.title_en, open.title_bn)}</figcaption>
            )}
          </figure>
        </div>
      )}
    </>
  );
}

export function ResourcesPage() {
  const { t, pick, formatDate } = useLang();
  usePageMeta(t.resources.title, t.resources.subtitle);

  const { state, retry } = useQuery<PublicDocument[]>(
    (db) =>
      db
        .from('downloadable_documents')
        .select('id,title_en,title_bn,description_en,description_bn,file_path,category,publish_at')
        .eq('status', 'published')
        .lte('publish_at', nowIso())
        .order('publish_at', { ascending: false })
        .limit(100),
    [],
  );

  return (
    <>
      <PageHeader title={t.resources.title} subtitle={t.resources.subtitle} crumbs={[{ to: '/academics', label: t.nav.academics }]} />
      <Section>
        <div className="mb-8 flex gap-3 rounded-xl border border-royal-100 bg-royal-50/60 p-5 text-sm text-slate-700">
          <Lock className="h-5 w-5 shrink-0 text-royal-600" aria-hidden />
          {t.resources.portalNote}
        </div>
        <QueryView state={state} retry={retry} empty={t.common.emptyDocuments}>
          {(rows) => (
            <ul className="grid gap-4 md:grid-cols-2">
              {rows.map((d) => (
                <li key={d.id}>
                  <Card className="flex h-full items-start gap-4 p-5">
                    <FileText className="h-8 w-8 shrink-0 text-royal-600" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-navy-900">{pick(d.title_en, d.title_bn)}</p>
                      {pick(d.description_en, d.description_bn) && (
                        <p className="mt-1 text-sm text-slate-600">{pick(d.description_en, d.description_bn)}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">{formatDate(d.publish_at)}</p>
                    </div>
                    <a
                      href={publicAssetUrl(supabase!, d.file_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass('outline', 'shrink-0 px-3')}
                      aria-label={`${t.common.download}: ${pick(d.title_en, d.title_bn)}`}
                    >
                      <Download className="h-4 w-4" aria-hidden />
                    </a>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Section>
    </>
  );
}

export function ExaminationsPage() {
  const { t } = useLang();
  usePageMeta(t.exams.title, t.exams.subtitle);

  const { state, retry } = useQuery<Notice[]>(
    (db) => {
      const now = nowIso();
      return db
        .from('notices')
        .select('id,title_en,title_bn,body_en,body_bn,category,publish_at,expires_at,attachment_path')
        .eq('status', 'published')
        .eq('category', 'examination')
        .lte('publish_at', now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order('publish_at', { ascending: false })
        .limit(10);
    },
    [],
  );

  return (
    <>
      <PageHeader title={t.exams.title} subtitle={t.exams.subtitle} crumbs={[{ to: '/academics', label: t.nav.academics }]} />
      <Section>
        <SectionHeading title={t.exams.schedulesTitle} />
        <QueryView state={state} retry={retry} empty={t.common.emptyNotices}>
          {(rows) => (
            <ul className="space-y-3">
              {rows.map((n) => (
                <NoticeRow key={n.id} notice={n} />
              ))}
            </ul>
          )}
        </QueryView>
      </Section>
      <Section tone="tint">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <h2 className="heading text-lg font-bold text-navy-900">{t.exams.gradingTitle}</h2>
            <div className="mt-3">
              <Placeholder label={t.exams.gradingTitle} note={t.exams.gradingBody} />
            </div>
          </Card>
          <Card>
            <h2 className="heading flex items-center gap-2 text-lg font-bold text-navy-900">
              <Lock className="h-5 w-5 text-royal-600" aria-hidden />
              {t.exams.resultsTitle}
            </h2>
            <p className="mt-3 text-slate-700">{t.exams.resultsBody}</p>
          </Card>
        </div>
      </Section>
    </>
  );
}
