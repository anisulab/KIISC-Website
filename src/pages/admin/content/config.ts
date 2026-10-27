import type { Dict } from '@/i18n/en';
import { EVENT_TYPES, NOTICE_CATEGORIES } from '@/lib/content';
import { DOCUMENT_TYPES, IMAGE_TYPES, type PublicFolder } from '@/lib/storage';

export type ContentKind = 'notices' | 'events' | 'gallery' | 'documents';
export type FieldName = keyof Dict['admin']['fields'];
type Options = (t: Dict) => { value: string; label: string }[];

export type FieldDef =
  | { name: FieldName; type: 'text'; maxLength?: number; required?: boolean; wide?: boolean }
  | { name: FieldName; type: 'textarea'; maxLength?: number; required?: boolean; wide?: boolean }
  | { name: FieldName; type: 'select'; options: Options; required?: boolean; wide?: boolean }
  | { name: FieldName; type: 'date' | 'datetime' | 'number'; required?: boolean; wide?: boolean }
  | { name: FieldName; type: 'file'; folder: PublicFolder; accept: string[]; required?: boolean; wide?: boolean };

export interface ContentConfig {
  kind: ContentKind;
  table: string;
  /** Columns shown in the list; `title_en,title_bn,status` are always included. */
  listColumns: string;
  dateColumn: string;
  dateIsTimestamp: boolean;
  order: { column: string; ascending: boolean }[];
  typeFilter?: { column: string; options: Options };
  thumbnailColumn?: string;
  publicPath?: (id: string) => string;
  fields: FieldDef[];
  defaults: () => Record<string, string>;
}

const statusOptions: Options = (t) =>
  (['draft', 'published', 'archived'] as const).map((s) => ({ value: s, label: t.admin.statuses[s] }));
const mediumOptions: Options = (t) => [
  { value: '', label: t.admin.mediums.all },
  { value: 'bangla_medium', label: t.admin.mediums.bangla_medium },
  { value: 'english_version', label: t.admin.mediums.english_version },
];
const languageOptions: Options = (t) =>
  (['both', 'bn', 'en'] as const).map((l) => ({ value: l, label: t.admin.languages[l] }));
const noticeCategoryOptions: Options = (t) => NOTICE_CATEGORIES.map((c) => ({ value: c, label: t.noticeCategories[c] }));
const eventTypeOptions: Options = (t) => EVENT_TYPES.map((e) => ({ value: e, label: t.eventTypes[e] }));

const today = () => new Date().toISOString().slice(0, 10);

export const CONTENT_CONFIGS: Record<ContentKind, ContentConfig> = {
  notices: {
    kind: 'notices',
    table: 'notices',
    listColumns: 'category,publish_at,expires_at,updated_at',
    dateColumn: 'publish_at',
    dateIsTimestamp: true,
    order: [{ column: 'publish_at', ascending: false }],
    typeFilter: { column: 'category', options: noticeCategoryOptions },
    publicPath: (id) => `/notices/${id}`,
    fields: [
      { name: 'title_en', type: 'text', maxLength: 300 },
      { name: 'title_bn', type: 'text', maxLength: 300 },
      { name: 'body_en', type: 'textarea', wide: true },
      { name: 'body_bn', type: 'textarea', wide: true },
      { name: 'category', type: 'select', options: noticeCategoryOptions, required: true },
      { name: 'target_medium', type: 'select', options: mediumOptions },
      { name: 'language', type: 'select', options: languageOptions, required: true },
      { name: 'status', type: 'select', options: statusOptions, required: true },
      { name: 'publish_at', type: 'datetime', required: true },
      { name: 'expires_at', type: 'datetime' },
      { name: 'attachment_path', type: 'file', folder: 'notices', accept: DOCUMENT_TYPES, wide: true },
    ],
    defaults: () => ({ category: 'general', language: 'both', status: 'draft', target_medium: '', publish_at: new Date().toISOString() }),
  },
  events: {
    kind: 'events',
    table: 'events',
    listColumns: 'event_type,starts_on,ends_on,updated_at',
    dateColumn: 'starts_on',
    dateIsTimestamp: false,
    order: [{ column: 'starts_on', ascending: false }],
    typeFilter: { column: 'event_type', options: eventTypeOptions },
    fields: [
      { name: 'title_en', type: 'text', maxLength: 300 },
      { name: 'title_bn', type: 'text', maxLength: 300 },
      { name: 'description_en', type: 'textarea', wide: true },
      { name: 'description_bn', type: 'textarea', wide: true },
      { name: 'event_type', type: 'select', options: eventTypeOptions, required: true },
      { name: 'target_medium', type: 'select', options: mediumOptions },
      { name: 'starts_on', type: 'date', required: true },
      { name: 'ends_on', type: 'date' },
      { name: 'location', type: 'text', maxLength: 200 },
      { name: 'status', type: 'select', options: statusOptions, required: true },
    ],
    defaults: () => ({ event_type: 'general', status: 'draft', target_medium: '', starts_on: today() }),
  },
  gallery: {
    kind: 'gallery',
    table: 'gallery_items',
    listColumns: 'album,image_path,sort_order,updated_at',
    dateColumn: 'updated_at',
    dateIsTimestamp: true,
    order: [
      { column: 'sort_order', ascending: true },
      { column: 'created_at', ascending: false },
    ],
    thumbnailColumn: 'image_path',
    fields: [
      { name: 'image_path', type: 'file', folder: 'gallery', accept: IMAGE_TYPES, required: true, wide: true },
      { name: 'title_en', type: 'text', maxLength: 200 },
      { name: 'title_bn', type: 'text', maxLength: 200 },
      { name: 'album', type: 'text', maxLength: 100 },
      { name: 'taken_on', type: 'date' },
      { name: 'sort_order', type: 'number' },
      { name: 'status', type: 'select', options: statusOptions, required: true },
    ],
    defaults: () => ({ status: 'draft', sort_order: '0' }),
  },
  documents: {
    kind: 'documents',
    table: 'downloadable_documents',
    listColumns: 'category,publish_at,updated_at',
    dateColumn: 'publish_at',
    dateIsTimestamp: true,
    order: [{ column: 'publish_at', ascending: false }],
    fields: [
      { name: 'title_en', type: 'text', maxLength: 300 },
      { name: 'title_bn', type: 'text', maxLength: 300 },
      { name: 'description_en', type: 'textarea', wide: true },
      { name: 'description_bn', type: 'textarea', wide: true },
      { name: 'category', type: 'text', maxLength: 100 },
      { name: 'status', type: 'select', options: statusOptions, required: true },
      { name: 'publish_at', type: 'datetime', required: true },
      { name: 'file_path', type: 'file', folder: 'documents', accept: DOCUMENT_TYPES, required: true, wide: true },
    ],
    defaults: () => ({ status: 'draft', publish_at: new Date().toISOString() }),
  },
};

/** Tables whose rows need at least one title (gallery photos may be untitled). */
export const TITLE_REQUIRED: ContentKind[] = ['notices', 'events', 'documents'];
