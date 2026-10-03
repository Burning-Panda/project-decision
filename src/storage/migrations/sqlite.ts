/**
 * Append-only list of schema changes for SqliteStore, applied in version order on open and recorded in `schema_migrations`.
 * Versions are 1..n without gaps. Never edit a released migration; add a new one (for example when a feature adds a collection).
 */
export interface SqliteMigration { version: number; name: string; up: () => string }

export const MIGRATIONS: SqliteMigration[] = [];
