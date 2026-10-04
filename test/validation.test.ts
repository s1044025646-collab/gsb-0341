import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '../src/validation.ts';
import { AppError } from '../src/errors.ts';

const expectCode = (code: string, body: unknown) => {
  try {
    validateSnapshot(body);
    assert.fail('应当抛错');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, code);
  }
};

test('合法输入通过（含全零、空集）', () => {
  assert.deepEqual(validateSnapshot({ keys: [], freqs: [] }).keys, []);
  assert.deepEqual(validateSnapshot({ keys: [-1, 0, 1], freqs: [0, 0, 0] }).freqs, [0, 0, 0]);
});

test('长度不一致', () => expectCode('LENGTH_MISMATCH', { keys: [1, 2], freqs: [1] }));
test('重复键', () => expectCode('DUPLICATE_KEY', { keys: [1, 1], freqs: [1, 1] }));
test('未排序（不静默排序）', () => expectCode('KEYS_NOT_SORTED', { keys: [3, 1, 2], freqs: [1, 1, 1] }));
test('非法键（小数/NaN/字符串）', () => {
  expectCode('INVALID_KEY', { keys: [1.5], freqs: [1] });
  expectCode('INVALID_KEY', { keys: [NaN], freqs: [1] });
  expectCode('INVALID_KEY', { keys: ['x'], freqs: [1] });
});
test('非法频数（负数/小数）', () => {
  expectCode('INVALID_FREQ', { keys: [1], freqs: [-1] });
  expectCode('INVALID_FREQ', { keys: [1], freqs: [1.2] });
});
test('超键数上限', () => {
  const keys = Array.from({ length: 201 }, (_, i) => i);
  expectCode('TOO_MANY_KEYS', { keys, freqs: keys.map(() => 1) });
});
test('超频数上限', () => expectCode('FREQ_OUT_OF_RANGE', { keys: [1], freqs: [1_000_000_001] }));
