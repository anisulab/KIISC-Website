import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderEmail, type Institution, type QueuedMessage } from '../../supabase/functions/send-notifications/templates.ts';

const inst: Institution = {
  name_en: 'Knowledge Inn International School and College',
  name_bn: 'নলেজ ইন ইন্টারন্যাশনাল স্কুল অ্যান্ড কলেজ',
  phone: '01301461643',
  email: 'kamrul336@gmail.com',
};
const student = { student_name_en: 'Arif Hossain', student_name_bn: 'আরিফ হোসেন', student_code: 'KI20260001' };
const msg = (event: string, data: Record<string, unknown>, language: QueuedMessage['language'] = 'both'): QueuedMessage => ({
  event,
  language,
  recipient_name: 'Rahim Hossain',
  data,
});

test('every event renders in both languages, Bangla first', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['admission_status', { reference_no: 'KI-APP-2026-00001', student_name_en: 'Nadia', student_name_bn: 'নাদিয়া', status: 'approved', status_note: null }],
    ['results_published', { ...student, exam_name_en: 'Half-yearly', exam_name_bn: 'অর্ধবার্ষিক' }],
    ['payment_received', { ...student, receipt_no: 'KI-RCT-2026-000031', amount: 1500, paid_on: '2026-10-08', method: 'mfs' }],
    ['attendance_absent', { ...student, date: '2026-10-26' }],
    ['fee_reminder', { ...student, balance: 1150, oldest_due: '2026-10-10' }],
  ];
  for (const [event, data] of cases) {
    const email = renderEmail(msg(event, data), inst, 'https://school.example');
    assert.ok(email.subject.includes(' | '), `${event}: bilingual subject`);
    assert.ok(email.html.indexOf('lang="bn"') < email.html.indexOf('lang="en"'), `${event}: Bangla first`);
    assert.ok(email.text.includes('Rahim Hossain'), `${event}: greeting`);
    assert.ok(email.text.includes(inst.phone), `${event}: school contact`);
  }
});

test('single-language emails contain only that language', () => {
  const email = renderEmail(msg('attendance_absent', { ...student, date: '2026-10-26' }, 'en'), inst);
  assert.equal(email.subject, 'Arif Hossain was absent today');
  assert.ok(!email.html.includes('lang="bn"'));
  assert.ok(email.text.includes('26 October 2026'));
});

test('amounts and dates are localised', () => {
  const email = renderEmail(msg('payment_received', { ...student, receipt_no: 'R1', amount: 1500, paid_on: '2026-10-08', method: 'cash' }, 'bn'), inst);
  assert.ok(email.text.includes('৳১,৫০০.০০'), email.text);
  assert.ok(email.text.includes('৮ অক্টোবর'), email.text);
});

test('database values are escaped in HTML', () => {
  const email = renderEmail(
    msg('admission_status', { reference_no: 'X', student_name_en: '<script>alert(1)</script>', status: 'info_required', status_note: 'Bring "birth" <certificate>' }, 'en'),
    inst,
  );
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes('&lt;script&gt;'));
  assert.ok(email.html.includes('&quot;birth&quot; &lt;certificate&gt;'));
  assert.equal(escapeHtml(`a&b'`), 'a&amp;b&#39;');
});

test('subjects never contain line breaks', () => {
  const email = renderEmail(msg('results_published', { ...student, exam_name_en: 'Final\r\nBcc: x@y.z' }, 'en'), inst);
  assert.ok(!/[\r\n]/.test(email.subject));
});

test('results emails never include marks, even if present in the data', () => {
  const email = renderEmail(msg('results_published', { ...student, exam_name_en: 'Final', gpa: 4.75, marks: { math: 99 } }), inst);
  assert.ok(!email.text.includes('4.75') && !email.text.includes('99'));
});

test('links are added only for a valid https site URL', () => {
  const data = { ...student, exam_name_en: 'Final' };
  assert.ok(renderEmail(msg('results_published', data, 'en'), inst, 'https://school.example').text.includes('https://school.example/portal'));
  assert.ok(!renderEmail(msg('results_published', data, 'en'), inst, 'javascript:alert(1)').text.includes('javascript'));
  assert.ok(!renderEmail(msg('results_published', data, 'en'), inst).text.includes('http'));
});

test('unknown events are rejected rather than sent blank', () => {
  assert.throws(() => renderEmail(msg('mystery', {}), inst), /unknown_event/);
});
