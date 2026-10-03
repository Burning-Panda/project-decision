import { todo } from '../helpers/errors/todo.js';

export const MAP_COLLECTIONS = ['owners', 'teams', 'projects', 'decisions', 'revisions', 'profiles'];
export const ARRAY_COLLECTIONS = ['votes', 'comments', 'followups', 'meetings', 'relationships', 'participants', 'audit', 'notifications', 'webhooks', 'events', 'deliveries', 'channel_deliveries'];
export const RECORD_COLLECTIONS = ['idempotency', 'counters'];

export class MemoryStore {
  persistent = false;
  constructor() {
    todo('MemoryStore');
  }
  static fromJSON(_json: unknown): MemoryStore {
    return todo('MemoryStore.fromJSON');
  }
}
