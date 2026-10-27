// Email templates for queued notifications (Bangla and/or English).
// Pure functions with no Deno or npm imports, so they are unit-tested with Node.
// Every value from the database is HTML-escaped; marks are never included.

export type Language = 'bn' | 'en' | 'both';

export interface Institution {
  name_en: string;
  name_bn: string | null;
  phone: string;
  email: string;
}

export interface QueuedMessage {
  event: string;
  language: Language;
  recipient_name: string | null;
  data: Record<string, unknown>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Part {
  subject: string;
  greeting: string;
  lines: string[];
  link?: { label: string; path: string };
  footer: string;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

function money(value: unknown, lang: 'bn' | 'en') {
  const n = Number(value ?? 0);
  return '৳' + new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function date(value: unknown, lang: 'bn' | 'en') {
  const s = str(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(s.slice(0, 10) + 'T00:00:00Z'),
  );
}

const ADMISSION_EN: Record<string, string> = {
  submitted: 'has been received. We will review it and contact you.',
  info_required: 'needs more information. Please contact the admission office.',
  approved: 'has been approved. Please contact the admission office to complete admission.',
  rejected: 'was not successful.',
  admitted: 'is complete: your child has been admitted. Welcome!',
};
const ADMISSION_BN: Record<string, string> = {
  submitted: 'গৃহীত হয়েছে। আমরা যাচাই করে আপনার সাথে যোগাযোগ করব।',
  info_required: 'এর জন্য আরও তথ্য প্রয়োজন। অনুগ্রহ করে ভর্তি অফিসে যোগাযোগ করুন।',
  approved: 'অনুমোদিত হয়েছে। ভর্তি সম্পন্ন করতে অনুগ্রহ করে ভর্তি অফিসে যোগাযোগ করুন।',
  rejected: 'সফল হয়নি।',
  admitted: 'সম্পন্ন হয়েছে: আপনার সন্তান ভর্তি হয়েছে। স্বাগতম!',
};
const METHODS_EN: Record<string, string> = { cash: 'cash', bank: 'bank', mfs: 'mobile banking', other: 'other' };
const METHODS_BN: Record<string, string> = { cash: 'নগদ', bank: 'ব্যাংক', mfs: 'মোবাইল ব্যাংকিং', other: 'অন্যান্য' };

function part(msg: QueuedMessage, inst: Institution, lang: 'bn' | 'en'): Part {
  const d = msg.data;
  const bn = lang === 'bn';
  const school = bn ? inst.name_bn || inst.name_en : inst.name_en;
  const student = bn ? str(d.student_name_bn) || str(d.student_name_en) : str(d.student_name_en) || str(d.student_name_bn);
  const name = str(msg.recipient_name);
  const greeting = bn ? `প্রিয় ${name || 'অভিভাবক'},` : `Dear ${name || 'Parent / Guardian'},`;
  const footer = bn
    ? `এটি ${school}-এর একটি স্বয়ংক্রিয় বার্তা। প্রশ্ন থাকলে ${inst.phone} নম্বরে ফোন করুন বা ${inst.email} ঠিকানায় লিখুন। এই ইমেইল বন্ধ করতে পোর্টালের "আমার অ্যাকাউন্ট" থেকে সেটিং পরিবর্তন করুন অথবা স্কুল অফিসে জানান।`
    : `This is an automatic message from ${school}. For questions call ${inst.phone} or write to ${inst.email}. To stop these emails, change the setting under "My account" in the portal or tell the school office.`;
  const portal = { label: bn ? 'পোর্টালে লগইন করুন' : 'Sign in to the portal', path: '/portal' };

  switch (msg.event) {
    case 'admission_status': {
      const status = str(d.status);
      const ref = str(d.reference_no);
      const applicant = bn ? str(d.student_name_bn) || str(d.student_name_en) : str(d.student_name_en) || str(d.student_name_bn);
      const note = str(d.status_note);
      return {
        subject: bn ? `ভর্তির আবেদন ${ref}` : `Admission application ${ref}`,
        greeting,
        lines: [
          bn
            ? `${applicant}-এর ভর্তির আবেদন (রেফারেন্স ${ref}) ${ADMISSION_BN[status] ?? 'হালনাগাদ হয়েছে।'}`
            : `The admission application for ${applicant} (reference ${ref}) ${ADMISSION_EN[status] ?? 'has been updated.'}`,
          ...(note ? [(bn ? 'স্কুলের বার্তা: ' : 'Message from the school: ') + note] : []),
          bn ? 'আবেদনের অবস্থা দেখতে রেফারেন্স নম্বর, অভিভাবকের মোবাইল নম্বর ও জন্ম তারিখ ব্যবহার করুন।' : 'You can check the status with the reference number, guardian mobile number and date of birth.',
        ],
        link: { label: bn ? 'আবেদনের অবস্থা দেখুন' : 'Check application status', path: '/admissions/status' },
        footer,
      };
    }
    case 'results_published': {
      const exam = bn ? str(d.exam_name_bn) || str(d.exam_name_en) : str(d.exam_name_en) || str(d.exam_name_bn);
      return {
        subject: bn ? `${exam}-এর ফলাফল প্রকাশিত হয়েছে` : `${exam} results are published`,
        greeting,
        lines: [
          bn ? `${student}-এর ${exam}-এর ফলাফল প্রকাশিত হয়েছে।` : `The ${exam} results for ${student} have been published.`,
          bn ? 'রিপোর্ট কার্ড দেখতে অভিভাবক পোর্টালে লগইন করুন।' : 'Sign in to the parent portal to see the report card.',
        ],
        link: portal,
        footer,
      };
    }
    case 'payment_received': {
      const method = (bn ? METHODS_BN : METHODS_EN)[str(d.method)] ?? str(d.method);
      return {
        subject: bn ? `পেমেন্ট গৃহীত — রসিদ ${str(d.receipt_no)}` : `Payment received — receipt ${str(d.receipt_no)}`,
        greeting,
        lines: [
          bn
            ? `${student}-এর জন্য ${date(d.paid_on, lang)} তারিখে ${money(d.amount, lang)} (${method}) গৃহীত হয়েছে। রসিদ নম্বর: ${str(d.receipt_no)}।`
            : `We received ${money(d.amount, lang)} (${method}) for ${student} on ${date(d.paid_on, lang)}. Receipt number: ${str(d.receipt_no)}.`,
          bn ? 'আপনার সন্তানের সব রসিদ ও বকেয়া পোর্টালে দেখা যাবে।' : 'All receipts and balances are available in the portal.',
        ],
        link: portal,
        footer,
      };
    }
    case 'attendance_absent':
      return {
        subject: bn ? `আজ ${student} অনুপস্থিত` : `${student} was absent today`,
        greeting,
        lines: [
          bn ? `${student} ${date(d.date, lang)} তারিখে স্কুলে অনুপস্থিত হিসেবে চিহ্নিত হয়েছে।` : `${student} was marked absent from school on ${date(d.date, lang)}.`,
          bn ? 'এটি ভুল হলে বা সন্তান অসুস্থ হলে অনুগ্রহ করে স্কুলে জানান।' : 'If this is a mistake or your child is unwell, please let the school know.',
        ],
        footer,
      };
    case 'fee_reminder':
      return {
        subject: bn ? `ফি বকেয়ার স্মরণিকা — ${student}` : `Fee reminder — ${student}`,
        greeting,
        lines: [
          bn
            ? `${student}-এর ${money(d.balance, lang)} বকেয়া রয়েছে${str(d.oldest_due) ? ` (প্রথম শেষ তারিখ ${date(d.oldest_due, lang)})` : ''}।`
            : `${student} has an outstanding balance of ${money(d.balance, lang)}${str(d.oldest_due) ? ` (first due on ${date(d.oldest_due, lang)})` : ''}.`,
          bn
            ? 'অনুগ্রহ করে স্কুলের হিসাব অফিসে বা অনুমোদিত মাধ্যমে পরিশোধ করুন এবং রসিদ সংরক্ষণ করুন। ইতিমধ্যে পরিশোধ করে থাকলে এই বার্তাটি উপেক্ষা করুন।'
            : 'Please pay at the school accounts office or by an approved method and keep your receipt. If you have already paid, please ignore this message.',
        ],
        link: portal,
        footer,
      };
    default:
      throw new Error(`unknown_event:${msg.event}`);
  }
}

function joinUrl(siteUrl: string | undefined, path: string) {
  if (!siteUrl) return null;
  try {
    const url = new URL(path, siteUrl);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Builds the subject, HTML and plain-text bodies. "both" puts Bangla first, then English. */
export function renderEmail(msg: QueuedMessage, inst: Institution, siteUrl?: string): RenderedEmail {
  const langs: ('bn' | 'en')[] = msg.language === 'both' ? ['bn', 'en'] : [msg.language];
  const parts = langs.map((l) => ({ lang: l, ...part(msg, inst, l) }));
  // Subjects never contain line breaks (header injection), whatever the stored data holds.
  const subject = parts.map((p) => p.subject).join(' | ').replace(/[\r\n]+/g, ' ').slice(0, 250);

  const textBlocks = parts.map((p) => {
    const url = p.link ? joinUrl(siteUrl, p.link.path) : null;
    return [p.greeting, '', ...p.lines, ...(url ? ['', `${p.link!.label}: ${url}`] : []), '', p.footer].join('\n');
  });

  const htmlBlocks = parts.map((p) => {
    const url = p.link ? joinUrl(siteUrl, p.link.path) : null;
    return [
      `<div lang="${p.lang}" style="margin:0 0 24px">`,
      `<p style="margin:0 0 12px">${escapeHtml(p.greeting)}</p>`,
      ...p.lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`),
      url
        ? `<p style="margin:16px 0"><a href="${escapeHtml(url)}" style="background:#1d40a6;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(p.link!.label)}</a></p>`
        : '',
      `<p style="margin:16px 0 0;font-size:12px;color:#64748b">${escapeHtml(p.footer)}</p>`,
      '</div>',
    ].join('');
  });

  const title = escapeHtml(langs[0] === 'bn' ? inst.name_bn || inst.name_en : inst.name_en);
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;background:#f8fafc;font-family:\'Noto Sans Bengali\',\'Hind Siliguri\',Arial,sans-serif;color:#0f172a;line-height:1.6">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px">' +
    `<div style="background:#0e1a3d;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold">${title}</div>` +
    '<div style="background:#fff;padding:24px 20px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:0">' +
    htmlBlocks.join('<hr style="border:0;border-top:1px solid #e2e8f0;margin:0 0 24px">') +
    '</div></div></body></html>';

  return { subject, html, text: textBlocks.join('\n\n— — —\n\n') };
}
