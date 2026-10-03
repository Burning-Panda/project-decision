import { NotImplementedError } from '../common/errors';

/**
 * A MemoryStore persisted to a SQLite file: one table per collection (`k text primary key, data text (JSON), updated_at`)
 * plus `schema_migrations`. open() applies src/storage/migrations/sqlite.ts and loads every collection; commit() writes
 * the changes since the last commit in one transaction; close() releases the file.
 */
export class SqliteStore {
  static open(_file: string): SqliteStore {
    throw new NotImplementedError('SqliteStore.open');
  }
}
