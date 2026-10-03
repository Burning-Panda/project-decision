import { NotImplementedError } from '../common/errors';
import type { SecretBox } from './secrets';

/**
 * Data migrations upgrade documents already stored when their shape changes (a new field, an encrypted value, ...).
 * Schema migrations change tables; data migrations change what is inside them.
 */
export interface DataMigrationContext { now: () => string; secretBox?: SecretBox }
export interface DataMigration { version: number; name: string; up: (store: any, ctx: DataMigrationContext) => void }

/** Append-only, versions 1..n. The log applies them on start (see DecisionLog). */
export const DATA_MIGRATIONS: DataMigration[] = [];

/**
 * Applies, in version order, the migrations not yet recorded in `store.data_migrations` (`{ [version]: { name, applied_at } }`)
 * and returns the versions applied. A migration that throws is not recorded, so it runs again next time.
 * Refuses a store that records a version newer than any migration given (the application is older than the data).
 */
export function applyDataMigrations(_store: any, _ctx: DataMigrationContext, _migrations: DataMigration[] = DATA_MIGRATIONS): number[] {
  throw new NotImplementedError('applyDataMigrations');
}
