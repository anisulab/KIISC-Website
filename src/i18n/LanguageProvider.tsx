import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en, { type Dict } from './en';
import bn from './bn';

export type Lang = 'bn' | 'en';

const STORAGE_KEY = 'kiisc.lang';
const dictionaries: Record<Lang, Dict> = { en, bn };

function readStoredLang(): Lang {
  // An explicit ?lang= in the URL (e.g. a shared link) wins over the stored preference.
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'bn' || fromUrl === 'en') return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'bn' || stored === 'en') return stored;
  } catch {
    // Storage can be unavailable (private mode); fall through to browser default.
  }
  return navigator.language?.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}

interface LanguageContextValue {
  lang: Lang;
  t: Dict;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  /** Picks the bilingual database field for the active language, falling back to the other. */
  pick: (enValue?: string | null, bnValue?: string | null) => string;
  formatDate: (value: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Non-critical: preference simply won't persist.
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggleLang = useCallback(() => setLangState((l) => (l === 'bn' ? 'en' : 'bn')), []);

  const value = useMemo<LanguageContextValue>(() => {
    const locale = lang === 'bn' ? 'bn-BD' : 'en-GB';
    return {
      lang,
      t: dictionaries[lang],
      setLang,
      toggleLang,
      pick: (enValue, bnValue) =>
        (lang === 'bn' ? bnValue || enValue : enValue || bnValue) ?? '',
      formatDate: (value, opts = { day: 'numeric', month: 'long', year: 'numeric' }) =>
        new Intl.DateTimeFormat(locale, opts).format(typeof value === 'string' ? new Date(value) : value),
    };
  }, [lang, setLang, toggleLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used inside LanguageProvider');
  return ctx;
}
