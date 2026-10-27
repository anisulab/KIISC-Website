import { supabase } from '@/integrations/supabase/client';

export type FunctionResult<T> = { ok: true; data: T } | { ok: false; code: string };

/**
 * Invokes an edge function and normalises failures to the `error` code the
 * function returned in its JSON body ('service_unavailable' if none).
 */
export async function invokeFunction<T = Record<string, unknown>>(
  name: string,
  body: Record<string, unknown> | FormData,
): Promise<FunctionResult<T>> {
  if (!supabase) return { ok: false, code: 'service_unavailable' };
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return { ok: true, data: (data ?? {}) as T };
  let code = 'service_unavailable';
  const response = (error as { context?: Response }).context;
  if (response && typeof response.json === 'function') {
    try {
      const parsed = await response.json();
      if (parsed?.error) code = String(parsed.error);
    } catch {
      // Non-JSON response: keep the generic code.
    }
  }
  return { ok: false, code };
}
