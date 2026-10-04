import { AppError } from './errors.js';
import { LIMITS } from './limits.js';

export interface SnapshotInput {
  keys: number[];
  freqs: number[];
  label?: string;
}

export interface ValidSnapshot {
  keys: number[];
  freqs: number[];
  label?: string;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Number.isFinite(value);
}

/**
 * 严格校验输入：
 * - 不静默排序，键必须严格递增，否则报 KEYS_NOT_SORTED / DUPLICATE_KEY
 * - 键为有限数值整数，频数为非负整数且不越界
 * - 空输入合法（返回确定的空结果）
 */
export function validateSnapshot(input: unknown): ValidSnapshot {
  if (typeof input !== 'object' || input === null) {
    throw new AppError('BAD_REQUEST', '请求体必须是对象');
  }
  const { keys, freqs, label } = input as Record<string, unknown>;
  if (!Array.isArray(keys) || !Array.isArray(freqs)) {
    throw new AppError('BAD_REQUEST', 'keys 与 freqs 必须是数组');
  }
  if (keys.length !== freqs.length) {
    throw new AppError(
      'LENGTH_MISMATCH',
      `keys 长度 ${keys.length} 与 freqs 长度 ${freqs.length} 不一致`,
      { keysLength: keys.length, freqsLength: freqs.length }
    );
  }
  if (keys.length > LIMITS.MAX_KEYS) {
    throw new AppError(
      'TOO_MANY_KEYS',
      `键数量 ${keys.length} 超过上限 ${LIMITS.MAX_KEYS}`,
      { maxKeys: LIMITS.MAX_KEYS, given: keys.length }
    );
  }

  const checkedKeys: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!isFiniteInteger(key)) {
      throw new AppError('INVALID_KEY', `第 ${i} 个键不是有限整数`, { index: i, value: key });
    }
    if (i > 0) {
      const prev = checkedKeys[i - 1] as number;
      if (key === prev) {
        throw new AppError('DUPLICATE_KEY', `键 ${key} 重复`, { key, index: i });
      }
      if (key < prev) {
        throw new AppError('KEYS_NOT_SORTED', `键未严格递增：位置 ${i} 的 ${key} < ${prev}`, {
          index: i,
          prev,
          current: key
        });
      }
    }
    checkedKeys.push(key);
  }

  const checkedFreqs: number[] = [];
  for (let i = 0; i < freqs.length; i++) {
    const freq = freqs[i];
    if (!isFiniteInteger(freq)) {
      throw new AppError('INVALID_FREQ', `第 ${i} 个频数不是有限整数`, { index: i, value: freq });
    }
    if (freq < 0) {
      throw new AppError('INVALID_FREQ', `第 ${i} 个频数为负数`, { index: i, value: freq });
    }
    if (freq > LIMITS.MAX_FREQ) {
      throw new AppError('FREQ_OUT_OF_RANGE', `第 ${i} 个频数 ${freq} 超过上限 ${LIMITS.MAX_FREQ}`, {
        index: i,
        value: freq,
        maxFreq: LIMITS.MAX_FREQ
      });
    }
    checkedFreqs.push(freq);
  }

  return { keys: checkedKeys, freqs: checkedFreqs, label: typeof label === 'string' ? label : undefined };
}
