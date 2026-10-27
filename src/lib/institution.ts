// Verified institutional information supplied by the school (2026-10-25).
// The database `institution_settings` row overrides these once connected;
// these values are the seed and the offline fallback, not mock data.

export interface InstitutionInfo {
  name_en: string;
  name_bn: string | null;
  address_en: string;
  address_bn: string | null;
  phone: string;
  whatsapp: string | null;
  email: string;
  about_en: string | null;
  about_bn: string | null;
  mission_en: string | null;
  mission_bn: string | null;
  vision_en: string | null;
  vision_bn: string | null;
  eiin: string | null;
  established_year: number | null;
  board_affiliation: string | null;
  office_hours_en: string | null;
  office_hours_bn: string | null;
  logo_path: string | null;
}

export const INSTITUTION_FALLBACK: InstitutionInfo = {
  name_en: 'Knowledge Inn International School and College',
  // Bengali rendering is a transliteration pending confirmation by the institution.
  name_bn: 'নলেজ ইন ইন্টারন্যাশনাল স্কুল অ্যান্ড কলেজ',
  address_en: 'Tushar Dhara Avenue, New Road, Jatrabari, Dhaka-1236, Bangladesh.',
  address_bn: 'তুষার ধারা অ্যাভিনিউ, নিউ রোড, যাত্রাবাড়ী, ঢাকা-১২৩৬, বাংলাদেশ।',
  phone: '01301461643',
  whatsapp: '01301461643',
  email: 'kamrul336@gmail.com',
  about_en:
    'We are committed to providing quality education that nurtures academic excellence, creativity, discipline, and moral values.',
  about_bn:
    'আমরা মানসম্মত শিক্ষা প্রদানে অঙ্গীকারবদ্ধ, যা একাডেমিক উৎকর্ষ, সৃজনশীলতা, শৃঙ্খলা ও নৈতিক মূল্যবোধ বিকশিত করে।',
  mission_en: 'To deliver student-centred education that develops knowledge, skills, confidence, and integrity.',
  mission_bn: 'শিক্ষার্থীকেন্দ্রিক শিক্ষা প্রদান করা, যা জ্ঞান, দক্ষতা, আত্মবিশ্বাস ও সততা বিকশিত করে।',
  vision_en:
    'To become a centre of educational excellence, preparing globally competent, responsible, and lifelong learners.',
  vision_bn:
    'শিক্ষায় উৎকর্ষের কেন্দ্র হয়ে ওঠা এবং বৈশ্বিকভাবে যোগ্য, দায়িত্বশীল ও আজীবন শিক্ষার্থী গড়ে তোলা।',
  eiin: null,
  established_year: null,
  board_affiliation: null,
  office_hours_en: null,
  office_hours_bn: null,
  logo_path: null,
};

/** "01301461643" -> "8801301461643" for wa.me / tel: links. */
export function toInternational(bdNumber: string) {
  const digits = bdNumber.replace(/\D/g, '');
  return digits.startsWith('880') ? digits : `88${digits}`;
}

export function toBnDigits(value: string) {
  return value.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}
