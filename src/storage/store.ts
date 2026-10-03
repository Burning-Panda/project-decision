import { NotImplementedError } from '../common/errors';

/**
 * The collections a store holds. They start with what the first features need and grow as you add features:
 * every new collection needs a table in each persistent store (a migration), and test/storage/collections.spec.ts
 * fails until it round-trips.
 *
 *   MAP     Map<key, document>      looked up by id
 *   ARRAY   document[]              ordered (the audit chain depends on order)
 *   RECORD  { [key]: value }        small keyed values (counters, applied data migrations, ...)
 */
export const MAP_COLLECTIONS = ['owners', 'teams', 'projects'];
export const ARRAY_COLLECTIONS = ['audit'];
export const RECORD_COLLECTIONS: string[] = [];

/** The in-memory working set every service reads and writes. Persistent stores extend it with commit() and close(). */
export class MemoryStore {
  persistent = false;
  constructor() {
    throw new NotImplementedError('MemoryStore');
  }

  /** Plain-JSON snapshot: maps become objects keyed by id, arrays stay arrays, records stay objects. */
  toJSON(): Record<string, unknown> {
    throw new NotImplementedError('MemoryStore.toJSON');
  }

  static fromJSON(_json: unknown): MemoryStore {
    throw new NotImplementedError('MemoryStore.fromJSON');
  }
}
