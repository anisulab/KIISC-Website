import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Search } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useQuery } from '@/hooks/useQuery';
import { supabase } from '@/integrations/supabase/client';
import {
  NOTICE_CATEGORIES,
  type Notice,
  type NoticeCategory,
  nowIso,
  publicAssetUrl,
  sanitizeSearch,
} from '@/lib/content';
import { Card, EmptyState, PageHeader, Pagination, QueryView, Section, buttonClass, inputClass } from '@/components/ui';
import { NoticeRow } from '@/components/content';

const PAGE_SIZE = 10;
const NOTICE_COLUMNS = 'id,title_en,title_bn,body_en,body_bn,category,publish_at,expires_at,attachment_path';

export function NoticesPage() {
  const { t } = useLang();
  usePageMeta(t.notices.title, t.notices.subtitle);
  const [params, setParams] = useSearchParams();

  const rawCategory = params.get('category');
  const category = NOTICE_CATEGORIES.includes(rawCategory as NoticeCategory) ? (rawCategory as NoticeCategory) : null;
  const q = sanitizeSearch(params.get('q') ?? '');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const update = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v);
      else merged.delete(k);
    }
    setParams(merged, { replace: true });
  };

  const { state, retry } = useQuery<Notice[]>(
    (db) => {
      const now = nowIso();
      let query = db
        .from('notices')
        .select(NOTICE_COLUMNS, { count: 'exact' })
        .eq('status', 'published')
        .lte('publish_at', now)
        .or(`expires_at.is.null,expires_at.gt.${now}`);
      if (category) query = query.eq('category', category);
      if (q) query = query.or(`title_en.ilike.*${q}*,title_bn.ilike.*${q}*`);
      const from = (page - 1) * PAGE_SIZE;
      return query.order('publish_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    },
    [category, q, page],
  );

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    update({ q: sanitizeSearch(draft) || null, page: null });
  };

  return (
    <>
      <PageHeader title={t.notices.title} subtitle={t.notices.subtitle} />
      <Section>
        <div className="mb-8 flex flex-col gap-3 md:flex-row">
          <form onSubmit={onSearch} className="flex flex-1 gap-2" role="search">
            <label htmlFor="notice-search" className="sr-only">
              {t.common.search}
            </label>
            <input
              id="notice-search"
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.common.searchPlaceholder}
              className={inputClass}
              maxLength={80}
            />
            <button type="submit" className={buttonClass('primary')} aria-label={t.common.search}>
              <Search className="h-4 w-4" aria-hidden />
            </button>
          </form>
          <div>
            <label htmlFor="notice-category" className="sr-only">
              {t.notices.category}
            </label>
            <select
              id="notice-category"
              value={category ?? ''}
              onChange={(e) => update({ category: e.target.value || null, page: null })}
              className={inputClass + ' md:w-56'}
            >
              <option value="">{t.common.allCategories}</option>
              {NOTICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.noticeCategories[c]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <QueryView state={state} retry={retry} empty={q || category ? t.common.emptySearch : t.common.emptyNotices}>
          {(rows, count) => (
            <>
              <ul className="space-y-3">
                {rows.map((n) => (
                  <NoticeRow key={n.id} notice={n} />
                ))}
              </ul>
              <Pagination
                page={page}
                totalPages={Math.ceil((count ?? 0) / PAGE_SIZE)}
                onChange={(p) => update({ page: p > 1 ? String(p) : null })}
              />
            </>
          )}
        </QueryView>
      </Section>
    </>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NoticeDetailPage() {
  const { id = '' } = useParams();
  const { t, pick, formatDate } = useLang();
  const validId = UUID_RE.test(id);

  const { state, retry } = useQuery<Notice | null>(
    (db) => {
      const now = nowIso();
      return db
        .from('notices')
        .select(NOTICE_COLUMNS)
        .eq('id', validId ? id : '00000000-0000-0000-0000-000000000000')
        .eq('status', 'published')
        .lte('publish_at', now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .maybeSingle();
    },
    [id],
  );

  const notice = state.status === 'ready' ? state.data : null;
  const title = notice ? pick(notice.title_en, notice.title_bn) : t.notices.title;
  usePageMeta(title, notice ? pick(notice.body_en, notice.body_bn).slice(0, 155) : undefined);

  return (
    <>
      <PageHeader title={title} crumbs={[{ to: '/notices', label: t.nav.notices }]} />
      <Section>
        <div className="mx-auto max-w-3xl">
          <Link to="/notices" className="no-print mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-700 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t.common.back}
          </Link>
          <QueryView state={state} retry={retry} empty={t.notices.notFound} isEmpty={(d) => d === null}>
            {(n) =>
              n ? (
                <Card className="p-6 sm:p-10">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                    <span className="rounded-full bg-gold-100 px-2.5 py-0.5 font-semibold text-gold-600">
                      {t.noticeCategories[n.category]}
                    </span>
                    <span>
                      {t.common.published}: <time dateTime={n.publish_at}>{formatDate(n.publish_at)}</time>
                    </span>
                    {n.expires_at && (
                      <span>
                        {t.common.validUntil}: <time dateTime={n.expires_at}>{formatDate(n.expires_at)}</time>
                      </span>
                    )}
                  </div>
                  {/* Plain text only: notice bodies are never rendered as HTML. */}
                  <div className="mt-6 whitespace-pre-line text-base leading-relaxed text-slate-800">
                    {pick(n.body_en, n.body_bn)}
                  </div>
                  <div className="no-print mt-8 flex flex-wrap gap-3">
                    {n.attachment_path && supabase && (
                      <a
                        href={publicAssetUrl(supabase, n.attachment_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass('primary')}
                      >
                        <Download className="h-4 w-4" aria-hidden />
                        {t.common.download}
                      </a>
                    )}
                    <button type="button" onClick={() => window.print()} className={buttonClass('outline')}>
                      <Printer className="h-4 w-4" aria-hidden />
                      {t.common.print}
                    </button>
                  </div>
                </Card>
              ) : (
                <EmptyState message={t.notices.notFound} />
              )
            }
          </QueryView>
        </div>
      </Section>
    </>
  );
}
