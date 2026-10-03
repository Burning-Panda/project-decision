import { HttpException } from '@nestjs/common';
import { DecisionLogError } from '../../common/errors.js';

export interface ErrorDescriptor { status: number; error: Record<string, unknown> }

/** Maps any thrown value to an HTTP status and error body. `allowedMethods` are the methods routed for the request path. */
export function describeError(e: any, allowedMethods: string[]): ErrorDescriptor {
  if (e instanceof DecisionLogError) return { status: e.status, error: { code: e.code, message: e.message, ...e.details } };
  if (e?.type === 'entity.parse.failed') return { status: 400, error: { code: 'INVALID_JSON', message: 'Request body must be a JSON object' } };
  if (e?.type === 'entity.too.large') return { status: 413, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } };
  if (e instanceof HttpException && e.getStatus() === 404) {
    return allowedMethods.length
      ? { status: 405, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }
      : { status: 404, error: { code: 'NOT_FOUND', message: 'Route not found' } };
  }
  if (e instanceof HttpException) return { status: e.getStatus(), error: { code: 'HTTP_ERROR', message: e.message } };
  console.error(e);
  return { status: 500, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
}

/** The standard failure envelope. */
export function errorEnvelope({ status, error }: ErrorDescriptor, action?: string) {
  return {
    success: false,
    status_code: status,
    ...(action ? { action_attempted: action } : {}),
    error,
    timestamp: new Date().toISOString(),
  };
}
