// 固定限制：保证 DP 规模与加权代价都保持精确整数（SQLite INTEGER 为 64 位有符号整数）
export const LIMITS = Object.freeze({
  MAX_KEYS: 200, // DP 为 O(n^3)，200 键约 130 万次区间-根尝试
  MAX_FREQ: 1_000_000_000, // 单键频数上限（非负整数）
  MAX_TOTAL_COST: Number.MAX_SAFE_INTEGER // JS 精确整数边界；远小于 2^63
});

export const ALGO_VERSION = 'obst-success-v1';

// 平局固定根选择规则：相同最小代价时选择最靠左（键序最小）的根
export const TIE_RULE = 'leftmost-root';
