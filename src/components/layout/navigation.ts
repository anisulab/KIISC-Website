import type { Dict } from '@/i18n/en';

export interface NavLinkItem {
  to: string;
  label: string;
}
export interface NavGroup {
  label: string;
  to?: string;
  children?: NavLinkItem[];
}

export function buildNav(t: Dict): NavGroup[] {
  const n = t.nav;
  return [
    { label: n.home, to: '/' },
    {
      label: n.about,
      children: [
        { to: '/about', label: n.aboutUs },
        { to: '/mission-vision', label: n.missionVision },
        { to: '/faculty', label: n.faculty },
        { to: '/faq', label: n.faq },
      ],
    },
    {
      label: n.academics,
      children: [
        { to: '/academics', label: n.programs },
        { to: '/academics/bangla-medium', label: n.banglaMedium },
        { to: '/academics/english-version', label: n.englishVersion },
        { to: '/examinations', label: n.examinations },
        { to: '/academic-calendar', label: n.calendar },
        { to: '/resources', label: n.resources },
      ],
    },
    {
      label: n.admissions,
      children: [
        { to: '/admissions', label: n.admissionInfo },
        { to: '/admissions/requirements', label: n.requirements },
      ],
    },
    { label: n.notices, to: '/notices' },
    { label: n.events, to: '/events' },
    { label: n.gallery, to: '/gallery' },
    { label: n.contact, to: '/contact' },
  ];
}
