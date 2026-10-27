import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useLang } from '@/i18n/LanguageProvider';
import { Spinner } from '@/components/ui';
import { useAuth, type AppRole } from './AuthProvider';
import { hasAnyRole } from './roles';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return <Spinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function AccessDenied() {
  const { t } = useLang();
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <ShieldAlert className="h-12 w-12 text-red-600" aria-hidden />
      <h1 className="heading mt-4 text-xl font-bold text-navy-900">{t.admin.accessDeniedTitle}</h1>
      <p className="mt-2 text-slate-600">{t.admin.accessDenied}</p>
    </div>
  );
}

/** Hides UI the user may not use. Real enforcement happens in the database (RLS). */
export function RequireRoles({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { me } = useAuth();
  return hasAnyRole(me, roles) ? <>{children}</> : <AccessDenied />;
}
