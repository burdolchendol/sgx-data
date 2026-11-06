import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFigure, toUnits, centsToUnits, detectUnits } from '../src/units.js';

test('parseFigure handles commas, parentheses, dashes', () => {
  assert.equal(parseFigure('1,234'), 1234);
  assert.equal(parseFigure('(1,234)'), -1234);
  assert.equal(parseFigure('−56.7'), -56.7);
  assert.equal(parseFigure('-'), null);
  assert.equal(parseFigure('—'), null);
  assert.equal(parseFigure('nm'), null);
  assert.equal(parseFigure('abc'), null);
});

test('detectUnits finds currency and scale, never assumes', () => {
  assert.deepEqual(detectUnits("Group S$'000"), { currency: 'SGD', scale: 1e3 });
  assert.deepEqual(detectUnits('In $ millions'), { currency: null, scale: 1e6 });
  assert.deepEqual(detectUnits('US$ million'), { currency: 'USD', scale: 1e6 });
  assert.deepEqual(detectUnits("RMB'000"), { currency: 'CNY', scale: 1e3 });
  assert.deepEqual(detectUnits('S$m'), { currency: 'SGD', scale: 1e6 });
  assert.deepEqual(detectUnits('Note 2025'), { currency: null, scale: null });
});

test('toUnits and centsToUnits', () => {
  assert.equal(toUnits(1.1, 1e6), 1100000);
  assert.equal(toUnits(5, null), null);
  assert.equal(centsToUnits(395), 3.95);
  assert.equal(centsToUnits(null), null);
});
