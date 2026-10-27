import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type AppRole =
  | 'super_admin'
  | 'school_admin'
  | 'principal'
  | 'accounts_officer'
  | 'admission_officer'
  | 'teacher'
  | 'student'
  | 'guardian';

export interface Me {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferred_language: 'bn' | 'en';
  is_active: boolean;
  /** Active roles from the database. Used for UI only; the database enforces access. */
  roles: AppRole[];
}

interface AuthContextValue {
  session: Session | null;
  /** True until the initial session (and profile, when signed in) has loaded. */
  initializing: boolean;
  /** True when the user opened a password-recovery link. */
  recovering: boolean;
  me: Me | null;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  initializing: false,
  recovering: false,
  me: null,
  refreshMe: async () => {},
});

async function loadMe(userId: string): Promise<Me | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('user_profiles')
    .select('id,full_name,email,phone,preferred_language,is_active,role_assignments(role,revoked_at)')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return null;
  const { role_assignments, ...profile } = data as Omit<Me, 'roles'> & {
    role_assignments: { role: AppRole; revoked_at: string | null }[];
  };
  return { ...profile, roles: role_assignments.filter((r) => !r.revoked_at).map((r) => r.role) };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(Boolean(supabase));
  const [recovering, setRecovering] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const userId = session?.user.id ?? null;
  // Still initialising until the signed-in user's profile and roles have loaded,
  // so guards never act on a session whose roles are not yet known.
  const initializing = sessionLoading || (userId !== null && loadedFor !== userId);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) {
      setMe(null);
      setLoadedFor(null);
      return;
    }
    let cancelled = false;
    loadMe(userId).then((loaded) => {
      if (cancelled) return;
      setMe(loaded);
      setLoadedFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refreshMe = useCallback(async () => {
    if (userId) setMe(await loadMe(userId));
  }, [userId]);

  return (
    <AuthContext.Provider value={{ session, initializing, recovering, me, refreshMe }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
