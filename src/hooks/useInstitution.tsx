import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { INSTITUTION_FALLBACK, type InstitutionInfo } from '@/lib/institution';
import { PUBLIC_BUCKET } from '@/lib/content';
import { supabase } from '@/integrations/supabase/client';

interface InstitutionContextValue {
  info: InstitutionInfo;
  logoUrl: string | null;
  refresh: () => Promise<void>;
}

const InstitutionContext = createContext<InstitutionContextValue>({
  info: INSTITUTION_FALLBACK,
  logoUrl: null,
  refresh: async () => {},
});

/** Loads admin-editable institution settings; keeps the verified fallback if unavailable. */
export function InstitutionProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<InstitutionInfo>(INSTITUTION_FALLBACK);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('institution_settings').select('*').maybeSingle();
    if (data) setInfo({ ...INSTITUTION_FALLBACK, ...data });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      info,
      refresh,
      logoUrl: info.logo_path && supabase ? supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(info.logo_path).data.publicUrl : null,
    }),
    [info, refresh],
  );

  return <InstitutionContext.Provider value={value}>{children}</InstitutionContext.Provider>;
}

export function useInstitution() {
  return useContext(InstitutionContext).info;
}

export function useInstitutionContext() {
  return useContext(InstitutionContext);
}
