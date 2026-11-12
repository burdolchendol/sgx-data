import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRows, findHeader, cells } from '../src/parse/layout.js';

const page = [
  'STATEMENTS OF FINANCIAL POSITION',
  'As at 31 March 2026',
  '                                    Group                    Company',
  '                               2026        2025         2026        2025',
  '                  Notes      S$ Mil      S$ Mil       S$ Mil      S$ Mil',
  '',
  'Current assets',
  'Cash and cash equivalents   15   3,470.4     2,773.2       93.1      221.2',
  'Other assets                19     214.4        38.6      111.7          -',
  '                                 8,924.4     8,191.4    2,418.8    2,747.8',
  'Fair value through other comprehensive income',
  '  (“FVOCI”) investments     27   3,589.4       736.1          -          -      Overview',
  'Misaligned line                      12.0',
  'Basic                          2.76        3.56',
].join('\n');

test('cells split on runs of 2+ spaces', () => {
  assert.deepEqual(cells('Total assets    50,696.9   46,783.3'), ['Total assets', '50,696.9', '46,783.3']);
});

test('findHeader reads year columns and units', () => {
  const h = findHeader(page.split('\n'));
  assert.deepEqual(h.years, [2026, 2025, 2026, 2025]);
  assert.deepEqual(h.units, { currency: 'SGD', scale: 1e6 });
});

test('findHeader finds units printed a few lines below the years', () => {
  const h = findHeader(['   31 March   31 March', '       2023       2022', '', '', '   S$ Mil   S$ Mil', 'Revenue  1.0  2.0']);
  assert.deepEqual(h.units, { currency: 'SGD', scale: 1e6 });
});

test('parseRows: note numbers dropped, dashes are zero, sections and subtotals kept', () => {
  const { rows } = parseRows(page);
  assert.deepEqual(rows[0], { label: 'Cash and cash equivalents', figures: [3470.4, 2773.2, 93.1, 221.2], section: 'current assets', heading: 'Current assets', line: 7 });
  assert.deepEqual(rows[1].figures, [214.4, 38.6, 111.7, 0]);
  assert.equal(rows[2].label, '');
  assert.deepEqual(rows[2].figures, [8924.4, 8191.4, 2418.8, 2747.8]);
});

test('parseRows joins wrapped labels and ignores side tabs', () => {
  const { rows } = parseRows(page);
  assert.equal(rows[3].label, 'Fair value through other comprehensive income (“FVOCI”) investments');
  assert.deepEqual(rows[3].figures, [3589.4, 736.1, 0, 0]);
});

test('parseRows places figures of short rows by column position, and skips ones that do not line up', () => {
  const { rows } = parseRows(page);
  assert.equal(rows.length, 5);
  assert.equal(rows[4].label, 'Basic');
  assert.deepEqual(rows[4].figures, [2.76, 3.56, null, null]);
});
