import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type QueryState<T> =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T; count: number | null };

// `data` is typed by the caller through T: without generated database types,
// supabase-js cannot infer embedded relations correctly (it assumes arrays).
type Runner = (
  client: SupabaseClient,
) => PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>;

/**
 * Runs a Supabase query and tracks loading / error / empty states.
 * `deps` controls when the query re-runs (filters, page, etc.).
 */
export function useQuery<T>(run: Runner, deps: unknown[]) {
  const [state, setState] = useState<QueryState<T>>(
    supabase ? { status: 'loading' } : { status: 'unconfigured' },
  );
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setState({ status: 'loading' });
    Promise.resolve(run(supabase))
      .then(({ data, error, count }) => {
        if (cancelled) return;
        if (error) setState({ status: 'error', message: error.message });
        else setState({ status: 'ready', data: data as T, count: count ?? null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { state, retry };
}
