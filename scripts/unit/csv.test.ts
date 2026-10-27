import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, csvFileName, toCsv } from '../../src/lib/csv.ts';

test('fields are quoted and quotes are doubled', () => {
  assert.equal(csvField('Hossain, Arif'), '"Hossain, Arif"');
  assert.equal(csvField('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
});

test('formula-like text cannot run in a spreadsheet', () => {
  for (const evil of ['=HYPERLINK("x")', '+cmd', '-2+3', '@SUM(A1)', '\tx']) {
    assert.ok(csvField(evil).startsWith(`"'`), evil);
  }
});

test('numbers stay numbers (negative amounts are not altered)', () => {
  assert.equal(csvField(-150.5), '-150.5');
  assert.equal(csvField(0), '0');
  assert.equal(csvField(Number.NaN), '');
});

test('empty values are empty fields', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('CSV has a UTF-8 BOM for Excel and CRLF line endings, and keeps Bengali text', () => {
  const csv = toCsv(['নাম', 'Roll'], [['আরিফ হোসেন', 1]]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv, '﻿"নাম","Roll"\r\n"আরিফ হোসেন",1\r\n');
});

test('file names are safe', () => {
  assert.equal(csvFileName('Tabulation sheet / Class 6', '2026-10-26'), 'tabulation-sheet-class-6-2026-10-26.csv');
  assert.equal(csvFileName('../../etc', '2026-10-26'), 'etc-2026-10-26.csv');
  assert.equal(csvFileName('শিক্ষার্থী', '2026-10-26'), 'report-2026-10-26.csv');
});
