import { beforeEach, expect } from 'bun:test';
import { makeClock } from './clock';
import { randomBytes } from './crypto';
import { U, CONTENT_V1 } from './fixtures';
import { buildLog, buildModule, SecretBox } from './target';

/** A fresh random-key SecretBox for tests that use persistent stores. */
export const testBox = () => new SecretBox({ keys: [randomBytes(32)] });

/**
 * Builds a log with one org, default team and project PRJ.
 * startAt/finder/threshold configure the log; every other key is an approval setting.
 */
export async function setup({ startAt, finder, threshold, ...settings }: Record<string, any> = {}) {
  const clock = makeClock(startAt);
  const log = await buildLog({ clock: clock.now, relatedFinder: finder, relatedThreshold: threshold });
  log.createOwner({ identifier: 'acme', name: 'Acme Inc', email: 'root@acme.com' });
  for (const u of [U.alice, U.bob, U.carol, U.david]) {
    log.addTeamMember({ owner: 'acme', team: 'default', user: u, role: 'member', actor: U.org });
  }
  log.addTeamMember({ owner: 'acme', team: 'default', user: U.lead, role: 'lead', actor: U.org });
  log.createProject({
    owner: 'acme', team: 'default', identifier: 'PRJ', title: 'Platform',
    description: 'Platform decisions',
    settings: Object.keys(settings).length ? { approval_settings: settings } : undefined,
    actor: U.org,
  });
  return { log, clock };
}

export type LogHandle = Awaited<ReturnType<typeof setup>>;

/**
 * Call inside a describe(): registers a beforeEach that builds a fresh `setup(settings)` log
 * and exposes { log, clock } on the returned handle, so every test starts from new state.
 */
export function freshLog(settings?: Record<string, any>): LogHandle {
  const h = {} as LogHandle;
  beforeEach(async () => { Object.assign(h, await setup(settings)); });
  return h;
}

export const draft = (log: any, over: Record<string, any> = {}) =>
  log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Migrate to new database', content: CONTENT_V1, ...over });

/** Call inside a describe(): like freshLog, plus PRJ-001 proposed by alice; `id` is set before each test. */
export function proposedIn(settings?: Record<string, any>): LogHandle & { id: string } {
  const h = freshLog(settings) as LogHandle & { id: string };
  beforeEach(() => { h.id = proposed(h.log); });
  return h;
}

export function proposed(log: any, over: Record<string, any> = {}) {
  const d = draft(log, over);
  log.perform(d.id, over.actor ?? U.alice, { action: 'propose', payload: {} });
  return d.id as string;
}

export const act = (log: any, id: string, actor: string, action: string, payload: Record<string, any> = {}, opts?: Record<string, any>) =>
  log.perform(id, actor, { action, payload }, opts);

export const vote = (log: any, id: string, who: string, v: string, comment?: string) =>
  act(log, id, who, 'vote', { vote: v, comment });

/** Runs fn and returns what it threw (undefined if nothing); for a WHEN whose action is expected to fail and leave state behind. */
export function attempt(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

/** Asserts that fn throws a DecisionLogError with the given code (and status); returns the error. */
export function expectCode(fn: () => unknown, code: string, status?: number): any {
  let error: any;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error, `expected error ${code} but nothing was thrown`).toBeDefined();
  expect(error.code, `expected ${code}, got ${error.code}: ${error.message}`).toBe(code);
  if (status) expect(error.status).toBe(status);
  return error;
}

/** A fixed clock plus a booted module, for specs that exercise parts directly. `get(X)` shares one store. */
export async function partsSetup(startAt?: string) {
  const clock = makeClock(startAt);
  const { get } = await buildModule({ clock: clock.now });
  return { get, clock };
}
