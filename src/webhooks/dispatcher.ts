import { todo } from '../helpers/errors/todo';

export class WebhookDispatcher {
  constructor(_log: unknown, _options: Record<string, any> = {}) {
    todo('WebhookDispatcher');
  }
}

export function verifySignature(_args: Record<string, any>): boolean {
  return todo('verifySignature');
}
