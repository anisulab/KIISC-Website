// Edge function: privileged user-account operations that need the service key.
// Authorisation is always checked against the caller's own database roles;
// role grants are written with the caller's client so RLS and audit apply.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = [
  'super_admin', 'school_admin', 'principal', 'accounts_officer',
  'admission_officer', 'teacher', 'student', 'guardian',
] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hasRole(client: SupabaseClient, role: string) {
  const { data, error } = await client.rpc('has_role', { _role: role });
  return !error && data === true;
}

function safeRedirect(value: unknown): string | undefined {
  // Supabase also validates redirects against the project's allow-list.
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'server_misconfigured' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await caller.auth.getUser();
  const callerId = userData.user?.id;
  if (!callerId) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  switch (body.action) {
    case 'create_user': {
      if (!(await hasRole(caller, 'super_admin'))) return json({ error: 'forbidden' }, 403);

      const email = String(body.email ?? '').trim().toLowerCase();
      const fullName = String(body.full_name ?? '').trim().slice(0, 150);
      const role = body.role ? String(body.role) : null;
      if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);
      if (!fullName) return json({ error: 'invalid_name' }, 400);
      if (role && !(ROLES as readonly string[]).includes(role)) return json({ error: 'invalid_role' }, 400);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createError || !created.user) {
        const exists = createError?.message?.toLowerCase().includes('already');
        return json({ error: exists ? 'email_exists' : 'create_failed' }, exists ? 409 : 500);
      }
      const userId = created.user.id;

      let roleError: string | null = null;
      if (role) {
        const { error } = await caller.from('role_assignments').insert({ user_id: userId, role });
        if (error) roleError = 'role_grant_failed';
      }

      const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: safeRedirect(body.redirect_to),
      });

      return json({
        user_id: userId,
        role_error: roleError,
        email_error: resetError ? 'email_failed' : null,
      });
    }

    case 'set_active': {
      const userId = String(body.user_id ?? '');
      const active = body.active === true;
      if (!UUID_RE.test(userId)) return json({ error: 'invalid_user' }, 400);

      // The database function enforces who may change whom.
      const { error } = await caller.rpc('set_user_active', { _user_id: userId, _active: active });
      if (error) return json({ error: error.code === '42501' ? 'forbidden' : 'update_failed' }, error.code === '42501' ? 403 : 500);

      // Also block (or restore) sign-in at the auth layer.
      const { error: banError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: active ? 'none' : '876000h',
      });
      return json({ ok: true, auth_error: banError ? 'ban_failed' : null });
    }

    case 'send_password_reset': {
      const isAdmin = (await hasRole(caller, 'super_admin')) || (await hasRole(caller, 'school_admin'));
      if (!isAdmin) return json({ error: 'forbidden' }, 403);
      const userId = String(body.user_id ?? '');
      if (!UUID_RE.test(userId)) return json({ error: 'invalid_user' }, 400);

      const { data: target, error } = await admin.auth.admin.getUserById(userId);
      if (error || !target.user?.email) return json({ error: 'not_found' }, 404);
      const { error: resetError } = await admin.auth.resetPasswordForEmail(target.user.email, {
        redirectTo: safeRedirect(body.redirect_to),
      });
      return resetError ? json({ error: 'email_failed' }, 500) : json({ ok: true });
    }

    default:
      return json({ error: 'unknown_action' }, 400);
  }
});
