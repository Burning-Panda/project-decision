import { NotImplementedError } from '../common/errors';

export class WebhookDispatcher {
  constructor(_log: unknown, _options: Record<string, any> = {}) {
    throw new NotImplementedError('WebhookDispatcher');
  }
}

export function verifySignature(_args: Record<string, any>): boolean {
  throw new NotImplementedError('verifySignature');
}
