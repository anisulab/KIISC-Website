// Edge function: public online admission submission.
// Accepts multipart/form-data:
//   application      JSON string with the form fields
//   doc:<type uuid>  one file per admission document type
//   captcha_token    (optional) Cloudflare Turnstile token, checked when TURNSTILE_SECRET_KEY is set
// Files go to the PRIVATE `admission-documents` bucket; all field validation,
// numbering and duplicate checks happen in submit_admission_application().
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_BODY_BYTES = 40 * 1024 * 1024;
const SUBMISSIONS_PER_HOUR = 5;
const BUCKET = 'admission-documents';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Errors raised by the database function that are safe to show to applicants.
const KNOWN_ERRORS = new Set([
  'ADMISSION_CLOSED', 'INVALID_YEAR', 'INVALID_CLASS', 'MISSING_FIELD', 'INVALID_DOB', 'INVALID_PHONE',
  'EMAIL_REQUIRED', 'INVALID_EMAIL', 'GENDER_REQUIRED', 'PREVIOUS_SCHOOL_REQUIRED', 'MISSING_DOCUMENTS',
  'DUPLICATE_APPLICATION', 'INVALID_DOCUMENTS',
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Detects the real file type from its first bytes; the browser-supplied type is not trusted. */
function sniffType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { mime: 'application/pdf', ext: 'pdf' }; // %PDF
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyCaptcha(token: string | null, ip: string) {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // CAPTCHA not configured
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'SERVER_MISCONFIGURED' }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json({ error: 'TOO_LARGE' }, 413);

  // Rate limit per client IP (stored only as a hash).
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipKey = 'apply:' + (await sha256Hex(ip + ':' + serviceKey.slice(-12)));
  const { data: allowed, error: limitError } = await admin.rpc('check_rate_limit', {
    p_key: ipKey,
    p_max: SUBMISSIONS_PER_HOUR,
    p_window: '1 hour',
  });
  if (limitError) return json({ error: 'SERVER_ERROR' }, 500);
  if (!allowed) return json({ error: 'TOO_MANY_REQUESTS' }, 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  if (!(await verifyCaptcha(form.get('captcha_token') as string | null, ip))) {
    return json({ error: 'CAPTCHA_FAILED' }, 400);
  }

  let application: Record<string, unknown>;
  try {
    application = JSON.parse(String(form.get('application') ?? ''));
    if (!application || typeof application !== 'object' || Array.isArray(application)) throw new Error();
  } catch {
    return json({ error: 'INVALID_INPUT' }, 400);
  }
  // Only known fields are forwarded.
  const fields = [
    'academic_year_id', 'class_id', 'medium', 'student_name_en', 'student_name_bn', 'date_of_birth', 'gender',
    'previous_school', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'guardian_email',
    'present_address', 'permanent_address',
  ];
  const payload = Object.fromEntries(fields.map((f) => [f, typeof application[f] === 'string' ? (application[f] as string).slice(0, 600) : null]));

  // Validate files before storing anything.
  const files: { typeId: string; file: File; bytes: Uint8Array; mime: string; ext: string }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('doc:')) continue;
    const typeId = key.slice(4);
    if (!UUID_RE.test(typeId) || !(value instanceof File)) return json({ error: 'INVALID_DOCUMENTS' }, 400);
    if (files.length >= MAX_FILES) return json({ error: 'INVALID_DOCUMENTS' }, 400);
    if (value.size === 0 || value.size > MAX_FILE_BYTES) return json({ error: 'FILE_TOO_LARGE', document_type_id: typeId }, 400);
    const bytes = new Uint8Array(await value.arrayBuffer());
    const type = sniffType(bytes);
    if (!type) return json({ error: 'FILE_TYPE_NOT_ALLOWED', document_type_id: typeId }, 400);
    files.push({ typeId, file: value, bytes, ...type });
  }

  const uploaded: string[] = [];
  const documents = [];
  try {
    for (const f of files) {
      const path = `applications/${crypto.randomUUID()}.${f.ext}`;
      const { error } = await admin.storage.from(BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false });
      if (error) throw error;
      uploaded.push(path);
      documents.push({
        document_type_id: f.typeId,
        storage_path: path,
        file_name: f.file.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200) || `document.${f.ext}`,
        mime_type: f.mime,
        size_bytes: f.bytes.byteLength,
      });
    }
  } catch {
    if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded);
    return json({ error: 'UPLOAD_FAILED' }, 500);
  }

  const { data, error } = await admin.rpc('submit_admission_application', {
    p_application: payload,
    p_documents: documents,
  });

  if (error) {
    if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded);
    const code = KNOWN_ERRORS.has(error.message)
      ? error.message
      : error.code === '23505'
        ? 'DUPLICATE_APPLICATION'
        : error.code === '22P02' || error.code === '22007' || error.code === '22008'
          ? 'INVALID_INPUT'
          : 'SERVER_ERROR';
    return json({ error: code }, code === 'SERVER_ERROR' ? 500 : 400);
  }

  return json({ reference_no: (data as { reference_no: string }).reference_no });
});
