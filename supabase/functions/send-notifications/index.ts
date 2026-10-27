// Edge function: sends queued email notifications from public.notification_outbox.
// Called by a scheduled job (header x-cron-secret = NOTIFY_CRON_SECRET) or by an
// administrator from the admin console ("Send queued emails now").
// The provider key stays here, server-side; the browser never sees it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { renderEmail, type Institution, type QueuedMessage } from './templates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const BATCH_SIZE = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function sendWithResend(apiKey: string, from: string, replyTo: string, to: string, id: string, email: ReturnType<typeof renderEmail>) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // A retried message is never delivered twice.
      'Idempotency-Key': id,
    },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject: email.subject, html: email.html, text: email.text }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return null;
  const detail = (await res.text().catch(() => '')).slice(0, 300);
  return `resend_${res.status}${detail ? `: ${detail}` : ''}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'server_misconfigured' }, 500);

  // Either the scheduler (shared secret) or a signed-in notifications administrator.
  const cronSecret = Deno.env.get('NOTIFY_CRON_SECRET');
  const givenSecret = req.headers.get('x-cron-secret');
  const isCron = Boolean(cronSecret && givenSecret && safeEqual(cronSecret, givenSecret));
  if (!isCron) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: userData } = await caller.auth.getUser();
    if (!userData.user) return json({ error: 'unauthorized' }, 401);
    const { data: allowed, error } = await caller.rpc('can_manage_notifications');
    if (error || allowed !== true) return json({ error: 'forbidden' }, 403);
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!apiKey || !from) return json({ error: 'email_not_configured' }, 503);
  const siteUrl = Deno.env.get('SITE_URL') ?? undefined;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: inst, error: instError } = await admin.from('institution_settings').select('name_en,name_bn,phone,email').single();
  if (instError || !inst) return json({ error: 'server_misconfigured' }, 500);

  const { data: batch, error: claimError } = await admin.rpc('claim_notifications', { p_limit: BATCH_SIZE });
  if (claimError) return json({ error: 'claim_failed' }, 500);

  let sent = 0;
  let failed = 0;
  for (const row of (batch ?? []) as (QueuedMessage & { id: string; recipient_email: string })[]) {
    let error: string | null;
    try {
      const email = renderEmail(row, inst as Institution, siteUrl);
      error = await sendWithResend(apiKey, from, (inst as Institution).email, row.recipient_email, row.id, email);
    } catch (e) {
      error = e instanceof Error ? e.message : 'send_failed';
    }
    await admin.rpc('complete_notification', { p_id: row.id, p_ok: error === null, p_error: error });
    if (error === null) sent++;
    else failed++;
  }

  return json({ claimed: (batch ?? []).length, sent, failed });
});
