/** 输入校验：所有非法输入抛出带稳定错误码的 ObstError。 */
export class ObstError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ObstError";
  }
}

export const MAX_KEYS = 200;
export const MAX_FREQ = 1_000_000;

export function validateInput(keys: unknown, frequencies: unknown): { keys: number[]; freqs: number[] } {
  if (!Array.isArray(keys) || !Array.isArray(frequencies)) {
    throw new ObstError("E_NOT_ARRAY", "keys 与 frequencies 必须是数组");
  }
  if (keys.length !== frequencies.length) {
    throw new ObstError("E_LENGTH_MISMATCH", `keys 长度 ${keys.length} 与 frequencies 长度 ${frequencies.length} 不一致`);
  }
  if (keys.length > MAX_KEYS) {
    throw new ObstError("E_TOO_MANY_KEYS", `键数量 ${keys.length} 超过上限 ${MAX_KEYS}`);
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (typeof k !== "number" || !Number.isFinite(k)) {
      throw new ObstError("E_KEY_NOT_FINITE", `键[${i}] 不是有限数值: ${String(k)}`);
    }
    const f = frequencies[i];
    if (typeof f !== "number" || !Number.isInteger(f) || f < 0) {
      throw new ObstError("E_FREQ_INVALID", `频数[${i}] 必须是非负整数: ${String(f)}`);
    }
    if (f > MAX_FREQ) {
      throw new ObstError("E_FREQ_TOO_LARGE", `频数[${i}]=${f} 超过上限 ${MAX_FREQ}`);
    }
    if (i > 0) {
      if (k === keys[i - 1]) throw new ObstError("E_DUP_KEY", `键重复: ${k}`);
      if (k < keys[i - 1]) throw new ObstError("E_NOT_SORTED", `键未严格递增: keys[${i - 1}]=${keys[i - 1]} >= keys[${i}]=${k}，拒绝静默排序`);
    }
  }
  // 累计代价上界 = n * sum(freq)，必须在安全整数范围内，计算前拒绝
  const sumFreq = (frequencies as number[]).reduce((a, b) => a + b, 0);
  const upperBound = sumFreq * Math.max(1, keys.length);
  if (upperBound > Number.MAX_SAFE_INTEGER) {
    throw new ObstError("E_COST_OVERFLOW", `累计代价上界 ${upperBound} 超过精确整数范围`);
  }
  return { keys: keys as number[], freqs: frequencies as number[] };
}
