export type ErrorCode =
  | 'EMPTY_KEYS'
  | 'LENGTH_MISMATCH'
  | 'DUPLICATE_KEY'
  | 'KEYS_NOT_SORTED'
  | 'INVALID_KEY'
  | 'INVALID_FREQ'
  | 'TOO_MANY_KEYS'
  | 'FREQ_OUT_OF_RANGE'
  | 'COST_OVERFLOW'
  | 'NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'CANDIDATE_MISSING_NODES'
  | 'CANDIDATE_EXTRA_NODES'
  | 'CANDIDATE_DUPLICATE_NODE'
  | 'CANDIDATE_NOT_A_TREE'
  | 'CANDIDATE_ORDER_VIOLATION'
  | 'CANDIDATE_MULTIPLE_ROOTS'
  | 'BAD_REQUEST'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}
