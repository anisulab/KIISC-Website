import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Browser client using the publishable (anon) key only. All authorisation is
 * enforced by Row Level Security in the database, never by this client.
 * `null` when the backend has not been connected yet.
 */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storage: localStorage },
      })
    : null;

export const isBackendConfigured = supabase !== null;
