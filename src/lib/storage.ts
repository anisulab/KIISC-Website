import { supabase } from '@/integrations/supabase/client';
import { PUBLIC_BUCKET } from './content';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];
export type PublicFolder = 'notices' | 'events' | 'gallery' | 'documents' | 'branding';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Returns an error key, or null when the file is acceptable. Storage enforces the same limits server-side. */
export function checkFile(file: File, allowed: string[]): 'tooLarge' | 'badType' | 'imageOnly' | null {
  if (!allowed.includes(file.type)) return allowed.includes('application/pdf') ? 'badType' : 'imageOnly';
  if (file.size > MAX_UPLOAD_BYTES) return 'tooLarge';
  return null;
}

/** Uploads to the PUBLIC bucket under a random name (the original filename is not exposed). */
export async function uploadPublicFile(folder: PublicFolder, file: File) {
  if (!supabase) throw new Error('Backend not configured');
  const path = `${folder}/${crypto.randomUUID()}.${EXTENSIONS[file.type] ?? 'bin'}`;
  const { error } = await supabase.storage.from(PUBLIC_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/**
 * Opens a file from a PRIVATE bucket through a 5-minute signed URL.
 * The tab is opened synchronously (avoids popup blockers), then pointed at the URL.
 * Returns false when the link could not be created (no permission or missing file).
 */
export async function openPrivateFile(bucket: string, path: string) {
  if (!supabase) return false;
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data) {
    tab?.close();
    return false;
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.assign(data.signedUrl);
  return true;
}

/** Uploads to a PRIVATE bucket under `<folder>/<random>.<ext>`. */
export async function uploadPrivateFile(bucket: string, folder: string, file: File) {
  if (!supabase) throw new Error('Backend not configured');
  const path = `${folder}/${crypto.randomUUID()}.${EXTENSIONS[file.type] ?? 'bin'}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/** Best-effort removal of a replaced or orphaned file. */
export async function removePublicFile(path: string | null | undefined) {
  // Files shipped with the website ("/...") are not in storage.
  if (!supabase || !path || path.startsWith('/')) return;
  await supabase.storage.from(PUBLIC_BUCKET).remove([path]);
}
