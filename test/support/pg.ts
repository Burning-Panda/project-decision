import { SQL } from 'bun';
import { beforeEach, afterEach } from 'bun:test';
import { PostgresStore } from './target.js';
import { randomHex } from './crypto.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const HAS_PG = Boolean(TEST_DATABASE_URL);

/**
 * Call inside a describe(): every test gets its own throwaway schema, dropped afterwards.
 * Populated before each test: { schema, open, q }. `q` runs raw SQL through Bun.SQL and returns rows.
 */
export function usePostgres() {
  const ctx: any = {};
  let admin: SQL;
  let opened: any[] = [];

  beforeEach(async () => {
    ctx.schema = `dl_test_${randomHex(5)}`;
    admin = new SQL(TEST_DATABASE_URL!);
    opened = [];
    ctx.open = async (opts: Record<string, any> = {}) => {
      const s = await PostgresStore.open(TEST_DATABASE_URL!, { schema: ctx.schema, ...opts });
      opened.push(s);
      return s;
    };
    ctx.q = (text: string, params: unknown[] = []) => admin.unsafe(text, params);
  });

  afterEach(async () => {
    for (const s of opened) await s.close().catch(() => {});
    await admin.unsafe(`DROP SCHEMA IF EXISTS "${ctx.schema}" CASCADE`);
    await admin.close();
  });

  return ctx;
}

/** Collects the SQL a store sends once start() is called; pass `hook` as the open() onStatement option. */
export function statementLog() {
  const statements: string[] = [];
  let on = false;
  return { statements, start: () => { on = true; }, hook: (text: string) => { if (on) statements.push(text); } };
}
