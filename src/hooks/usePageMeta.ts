import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLang } from '@/i18n/LanguageProvider';

const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, '');

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/** Sets title, description, Open Graph tags, canonical URL and robots for the current page. */
export function usePageMeta(title: string, description?: string, opts: { noindex?: boolean } = {}) {
  const { t, lang } = useLang();
  const { pathname } = useLocation();

  useEffect(() => {
    const fullTitle = title ? `${title} | ${t.meta.siteName}` : t.meta.siteName;
    const desc = description || t.meta.description;
    document.title = fullTitle;
    setMeta('name', 'description', desc);
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:locale', lang === 'bn' ? 'bn_BD' : 'en_GB');
    setMeta('name', 'robots', opts.noindex ? 'noindex, nofollow' : 'index, follow');
    const canonical = SITE_URL && !opts.noindex ? `${SITE_URL}${pathname}` : null;
    setCanonical(canonical);
    if (canonical) setMeta('property', 'og:url', canonical);
  }, [title, description, t, lang, pathname, opts.noindex]);
}
