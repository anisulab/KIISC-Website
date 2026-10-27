import type { SupabaseClient } from '@supabase/supabase-js';

export const NOTICE_CATEGORIES = [
  'general',
  'admission',
  'examination',
  'holiday',
  'event',
  'parent_meeting',
  'academic',
] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const EVENT_TYPES = [
  'academic',
  'examination',
  'holiday',
  'parent_meeting',
  'cultural',
  'sports',
  'general',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface Notice {
  id: string;
  title_en: string | null;
  title_bn: string | null;
  body_en: string | null;
  body_bn: string | null;
  category: NoticeCategory;
  publish_at: string;
  expires_at: string | null;
  attachment_path: string | null;
}

export interface SchoolEvent {
  id: string;
  title_en: string | null;
  title_bn: string | null;
  description_en: string | null;
  description_bn: string | null;
  event_type: EventType;
  starts_on: string;
  ends_on: string | null;
  location: string | null;
}

export interface GalleryItem {
  id: string;
  title_en: string | null;
  title_bn: string | null;
  image_path: string;
  album: string | null;
}

export interface PublicDocument {
  id: string;
  title_en: string | null;
  title_bn: string | null;
  description_en: string | null;
  description_bn: string | null;
  file_path: string;
  category: string | null;
  publish_at: string;
}

export const PUBLIC_BUCKET = 'public-assets';

/**
 * Public URL of an uploaded file. Paths starting with "/" are files shipped with
 * the website itself (in /public), e.g. photos added before storage was set up.
 */
export function publicAssetUrl(client: SupabaseClient, path: string) {
  if (path.startsWith('/')) return path;
  return client.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Removes characters that have meaning inside PostgREST `or=(...)` filters. */
export function sanitizeSearch(q: string) {
  return q.replace(/[,()*%\\:."']/g, ' ').trim().slice(0, 80);
}

/**
 * Published-and-current filter applied explicitly in queries, so that signed-in
 * staff (whom RLS also allows to read drafts) still see only public content here.
 */
export function nowIso() {
  return new Date().toISOString();
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
