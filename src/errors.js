export class DecisionLogError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'DecisionLogError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what) => new DecisionLogError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (msg) => new DecisionLogError('FORBIDDEN', msg, 403);
export const invalid = (msg) => new DecisionLogError('VALIDATION_ERROR', msg, 400);
export const conflict = (msg) => new DecisionLogError('CONFLICT', msg, 409);
