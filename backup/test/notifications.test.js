import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NotificationChannel, NotificationManager, createNotificationPayload, validateNotificationPayload,
  sent, failed, skipped, isDeliveryResult, checkChannelConformance,
} from '../src/notifications/index.js';
import { DecisionLog } from '../src/decision-log.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { setup, proposed, act, assertCode, makeClock, testBox, U } from './helpers.js';

// ---------------------------------------------------------------- test doubles
class FakeChannel extends NotificationChannel {
  constructor(channelName, { needs = 'email', script = [] } = {}) {
    super();
    this.channelName = channelName;
    this.needs = needs;
    this.script = script; // results (or Errors) returned by successive send() calls; last one repeats
    this.calls = [];
  }
  get name() { return this.channelName; }
  supports(payload) { return Boolean(this.needs === 'push_tokens' ? payload.recipient.push_tokens.length : payload.recipient[this.needs]); }
  async send(payload) {
    this.calls.push(payload);
    const next = this.script[Math.min(this.calls.length - 1, this.script.length - 1)] ?? sent(`${this.name}-${this.calls.length}`);
    if (next instanceof Error) throw next;
    return next;
  }
}
const email = (script) => new FakeChannel('email', { needs: 'email', script });
const sms = (script) => new FakeChannel('sms', { needs: 'phone', script });
const push = (script) => new FakeChannel('push', { needs: 'push_tokens', script });

const INPUT = {
  id: 'notif-001', type: 'decision_proposed',
  recipient: { user: U.bob, email: U.bob },
  content: { title: 'Decision proposed', body: 'PRJ-001 needs your review' },
};

// ---------------------------------------------------------------- payload
test('createNotificationPayload fills defaults and freezes the result', () => {
  const p = createNotificationPayload(INPUT);
  assert.equal(p.version, 1);
  assert.equal(p.priority, 'normal');
  assert.deepEqual(p.recipient, { user: U.bob, email: U.bob, phone: null, push_tokens: [] });
  assert.deepEqual(p.content, { title: 'Decision proposed', body: 'PRJ-001 needs your review', html: null, link: null });
  assert.deepEqual(p.context, { decision_id: null, project: null, actor: null });
  assert.deepEqual(p.data, {});
  assert.equal(p.dedupe_key, 'notif-001');
  assert.match(p.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Object.isFrozen(p), true);
  assert.equal(Object.isFrozen(p.recipient), true);
  assert.throws(() => { 'use strict'; p.content.title = 'x'; }, TypeError);
});

test('payload validation reports every problem', () => {
  const errors = validateNotificationPayload({ type: '', priority: 'urgent', recipient: { user: '', email: 'nope', phone: '12', push_tokens: 'abc' }, content: { title: '', body: 'x'.repeat(10_001), link: 'javascript:alert(1)' }, data: { f() {} } });
  for (const frag of ['type', 'priority', 'recipient.user', 'recipient.email', 'recipient.phone', 'recipient.push_tokens', 'content.title', 'content.body', 'content.link', 'data']) {
    assert.ok(errors.some((e) => e.startsWith(frag)), `expected an error for ${frag}: ${errors.join(' | ')}`);
  }
  assertCode(() => createNotificationPayload({ ...INPUT, priority: 'urgent' }), 'VALIDATION_ERROR', 400);
  assert.deepEqual(validateNotificationPayload(createNotificationPayload(INPUT)), []);
  const circular = {}; circular.self = circular;
  assert.ok(validateNotificationPayload({ ...INPUT, data: circular }).some((e) => e.startsWith('data')));
  assert.ok(validateNotificationPayload({ ...INPUT, recipient: { user: 'a', email: 'a@b.co\r\nBcc: x@y.z' } }).some((e) => e.startsWith('recipient.email')), 'header injection');
});

test('delivery result helpers', () => {
  assert.deepEqual(sent('abc'), { status: 'sent', provider_id: 'abc' });
  assert.deepEqual(failed('boom'), { status: 'failed', error: 'boom', retryable: true });
  assert.deepEqual(failed('bad address', { retryable: false }), { status: 'failed', error: 'bad address', retryable: false });
  assert.deepEqual(skipped('no_address'), { status: 'skipped', reason: 'no_address' });
  for (const r of [sent('x'), failed('x'), skipped('x')]) assert.equal(isDeliveryResult(r), true);
  for (const r of [null, {}, { status: 'ok' }, { status: 'failed' }, { status: 'failed', error: 'x' }, 'sent']) assert.equal(isDeliveryResult(r), false);
});

// ---------------------------------------------------------------- channel contract
test('NotificationChannel is abstract', async () => {
  const c = new NotificationChannel();
  assert.throws(() => c.name, /implement/i);
  assert.throws(() => c.supports({}), /implement/i);
  await assert.rejects(c.send({}), /implement/i);
});

test('the conformance kit accepts a well-behaved channel and flags broken ones', async () => {
  const ok = email();
  assert.deepEqual(await checkChannelConformance(ok, { payload: createNotificationPayload(INPUT), unaddressable: createNotificationPayload({ ...INPUT, recipient: { user: 'x' } }) }), []);

  class Broken extends NotificationChannel {
    get name() { return 'Bad Name'; }
    supports() { return 'yes'; }
    async send(payload) { try { payload.data.x = 1; } catch { /* frozen */ } return { status: 'delivered' }; }
  }
  const problems = await checkChannelConformance(new Broken(), { payload: createNotificationPayload(INPUT) });
  assert.ok(problems.some((p) => /name/.test(p)));
  assert.ok(problems.some((p) => /supports/.test(p)));
  assert.ok(problems.some((p) => /delivery result/i.test(p)));
});

// ---------------------------------------------------------------- manager registration
test('the manager validates and registers channels', () => {
  const { log } = setup();
  const manager = new NotificationManager(log);
  manager.register(email());
  assert.deepEqual(manager.channelNames, ['email']);
  assert.throws(() => manager.register(email()), /already registered/i);
  assert.throws(() => manager.register({ name: 'x', send() {} }), /NotificationChannel/);
  assert.throws(() => manager.register(new FakeChannel('Not Valid!')), /name/);
});

// ---------------------------------------------------------------- profiles & preferences
test('profiles default sensibly: email derives from the user id, email is the only channel on', () => {
  const { log } = setup();
  const p = log.getProfile(U.bob, U.bob);
  assert.equal(p.email, U.bob);
  assert.equal(p.phone, null);
  assert.deepEqual(p.push_tokens, []);
  assert.deepEqual(p.preferences, { channels: { email: true, sms: false, push: false }, order: ['email', 'sms', 'push'], mode: 'all', muted_types: [] });
  log.addTeamMember({ owner: 'acme', user: 'acme-bot', actor: 'acme' });
  assert.equal(log.getProfile('acme-bot', 'acme').email, null, 'ids that are not addresses have no email');
});

test('profile updates merge, validate and respect permissions', () => {
  const { log } = setup();
  const p = log.setProfile(U.bob, U.bob, { phone: '+14155550123', preferences: { channels: { sms: true }, muted_types: ['vote_received'] } });
  assert.equal(p.phone, '+14155550123');
  assert.deepEqual(p.preferences.channels, { email: true, sms: true, push: false });
  const again = log.setProfile(U.bob, U.bob, { push_tokens: ['tok-1'], preferences: { mode: 'fallback', order: ['push', 'email'] } });
  assert.equal(again.phone, '+14155550123', 'earlier fields kept');
  assert.deepEqual(again.preferences.muted_types, ['vote_received']);
  assert.equal(again.preferences.mode, 'fallback');
  assert.deepEqual(again.preferences.order, ['push', 'email']);

  const bad = (input) => assertCode(() => log.setProfile(U.bob, U.bob, input), 'VALIDATION_ERROR', 400);
  bad({ email: 'not-an-email' });
  bad({ email: 'a@b.co\r\nBcc: evil@x.io' });
  bad({ phone: '555-1234' });
  bad({ push_tokens: 'abc' });
  bad({ push_tokens: Array(11).fill('t') });
  bad({ preferences: { channels: { fax: true } } });
  bad({ preferences: { channels: { sms: 'yes' } } });
  bad({ preferences: { mode: 'sometimes' } });
  bad({ preferences: { order: ['email', 'email'] } });
  bad({ preferences: { muted_types: 'all' } });

  assertCode(() => log.getProfile(U.bob, U.carol), 'FORBIDDEN', 403);
  assertCode(() => log.setProfile(U.bob, U.carol, { phone: '+14155550123' }), 'FORBIDDEN', 403);
  assert.equal(log.setProfile(U.bob, U.org, { email: 'bob@personal.example' }).email, 'bob@personal.example', 'org admin may edit');
  assert.equal(log.setProfile(U.bob, U.bob, { phone: null }).phone, null);
});

// ---------------------------------------------------------------- manager runs
function managed(channels, { settings, appUrl = 'https://dl.example.com' } = {}) {
  const ctx = setup(settings);
  const manager = new NotificationManager(ctx.log, { appUrl });
  for (const c of channels) manager.register(c);
  return { ...ctx, manager };
}

test('in-app notifications are turned into standard payloads and sent once', async () => {
  const mail = email();
  const { log, manager } = managed([mail]);
  const id = proposed(log); // notifies bob, carol, david and the lead
  const stats = await manager.run();
  assert.equal(stats.planned, log.store.notifications.length);
  assert.equal(stats.sent, mail.calls.length);
  const toBob = mail.calls.find((p) => p.recipient.user === U.bob);
  assert.equal(toBob.type, 'decision_proposed');
  assert.equal(toBob.content.title, `[${id}] Decision proposed for review`);
  assert.match(toBob.content.body, /was proposed/);
  assert.equal(toBob.content.link, `https://dl.example.com/#/d/${id}`);
  assert.equal(toBob.recipient.email, U.bob);
  assert.deepEqual(toBob.context, { decision_id: id, project: 'PRJ', actor: null });
  assert.equal(toBob.priority, 'normal');
  assert.deepEqual(validateNotificationPayload(toBob), []);
  const before = mail.calls.length;
  assert.deepEqual(await manager.run(), { planned: 0, sent: 0, failed: 0, skipped: 0, retrying: 0 });
  assert.equal(mail.calls.length, before, 'never re-sent');
});

test('preferences: muted types and disabled channels are respected', async () => {
  const mail = email();
  const { log, manager } = managed([mail], { settings: { mode: 'consensus_voting' } });
  log.setProfile(U.alice, U.alice, { preferences: { muted_types: ['vote_received'] } });
  log.setProfile(U.carol, U.carol, { preferences: { channels: { email: false } } });
  const id = proposed(log);
  act(log, id, U.bob, 'vote', { vote: 'approve' }); // -> alice (muted)
  await manager.run();
  assert.equal(mail.calls.some((p) => p.recipient.user === U.alice && p.type === 'vote_received'), false);
  assert.equal(mail.calls.some((p) => p.recipient.user === U.carol), false);
  assert.equal(mail.calls.some((p) => p.recipient.user === U.david), true);
  assert.ok(log.store.notifications.every((n) => n.planned));
});

test('several channels deliver seamlessly side by side; missing addresses are skipped', async () => {
  const mail = email(), text = sms(), pushy = push();
  const { log, manager } = managed([mail, text, pushy]);
  log.setProfile(U.bob, U.bob, { phone: '+14155550123', push_tokens: ['tok'], preferences: { channels: { sms: true, push: true } } });
  log.setProfile(U.carol, U.carol, { preferences: { channels: { sms: true, push: true } } }); // enabled but no phone/token
  proposed(log);
  const stats = await manager.run();
  const forUser = (c, u) => c.calls.filter((p) => p.recipient.user === u).length;
  assert.deepEqual([forUser(mail, U.bob), forUser(text, U.bob), forUser(pushy, U.bob)], [1, 1, 1]);
  assert.deepEqual([forUser(mail, U.carol), forUser(text, U.carol), forUser(pushy, U.carol)], [1, 0, 0]);
  assert.equal(stats.skipped, 2);
  assert.ok(log.store.channel_deliveries.some((d) => d.channel === 'sms' && d.status === 'skipped' && d.last_error === 'no_address'));
});

test('fallback mode tries channels in order until one succeeds', async () => {
  const mail = email(), text = sms([failed('carrier rejected', { retryable: false })]), pushy = push([failed('token expired', { retryable: false })]);
  const { log, manager } = managed([mail, text, pushy]);
  log.setProfile(U.bob, U.bob, { phone: '+14155550123', push_tokens: ['tok'], preferences: { mode: 'fallback', order: ['push', 'sms', 'email'], channels: { push: true, sms: true } } });
  proposed(log);
  await manager.run();
  assert.equal(pushy.calls.filter((p) => p.recipient.user === U.bob).length, 1);
  assert.equal(text.calls.filter((p) => p.recipient.user === U.bob).length, 1);
  assert.equal(mail.calls.filter((p) => p.recipient.user === U.bob).length, 1, 'email is the last resort');

  const mail2 = email(), pushOk = push();
  const second = managed([mail2, pushOk]);
  second.log.setProfile(U.bob, U.bob, { push_tokens: ['tok'], preferences: { mode: 'fallback', order: ['push', 'email'], channels: { push: true } } });
  proposed(second.log);
  await second.manager.run();
  assert.equal(mail2.calls.some((p) => p.recipient.user === U.bob), false, 'push succeeded, so no email');
  const row = second.log.store.channel_deliveries.find((d) => d.channel === 'email' && d.notification_id === second.log.store.notifications.find((n) => n.user === U.bob).id);
  assert.equal(row.status, 'skipped');
  assert.equal(row.last_error, 'fallback_not_needed');
});

test('retryable failures back off and give up; permanent failures stop immediately', async () => {
  const flaky = email([failed('temporary'), failed('temporary'), sent('ok-1')]);
  const { log, clock, manager } = managed([flaky]);
  log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
  act(log, 'PRJ-001', U.alice, 'propose');
  log.store.notifications.splice(1); // keep a single notification (to bob)
  const only = log.store.notifications[0];
  const row = () => log.store.channel_deliveries.find((d) => d.notification_id === only.id);

  assert.equal((await manager.run()).retrying, 1);
  assert.equal(row().attempts, 1);
  assert.equal(row().next_attempt_at, '2024-03-20T10:01:00.000Z');
  await manager.run();
  assert.equal(flaky.calls.length, 1, 'not due yet');
  clock.advanceMinutes(2);
  await manager.run();
  assert.equal(row().next_attempt_at, '2024-03-20T10:07:00.000Z');
  clock.advanceMinutes(6);
  assert.equal((await manager.run()).sent, 1);
  assert.equal(row().status, 'sent');
  assert.equal(row().provider_id, 'ok-1');

  const dead = email([failed('mailbox does not exist', { retryable: false })]);
  const two = managed([dead]);
  proposed(two.log);
  await two.manager.run();
  assert.ok(two.log.store.channel_deliveries.every((d) => d.status === 'failed' && d.attempts === 1));

  const down = email([failed('timeout')]);
  const three = managed([down]);
  three.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
  act(three.log, 'PRJ-001', U.alice, 'propose');
  for (let i = 0; i < 6; i++) { await three.manager.run(); three.clock.advanceHours(13); }
  const first = three.log.store.channel_deliveries[0];
  assert.equal(first.status, 'failed');
  assert.equal(first.attempts, 5);
});

test('a channel that throws is treated as a retryable failure', async () => {
  const boom = email([new Error('socket hang up'), sent('fine')]);
  const { log, clock, manager } = managed([boom]);
  proposed(log);
  const stats = await manager.run();
  assert.ok(stats.retrying > 0);
  assert.match(log.store.channel_deliveries[0].last_error, /socket hang up/);
  clock.advanceMinutes(2);
  assert.ok((await manager.run()).sent > 0);
});

test('a malformed result from a channel is a failure, not a crash', async () => {
  const bad = email([{ ok: true }]);
  const { log, manager } = managed([bad]);
  proposed(log);
  assert.ok((await manager.run()).retrying > 0);
  assert.match(log.store.channel_deliveries[0].last_error, /invalid delivery result/i);
});

test('unregistered channels fail their pending rows instead of blocking the queue', async () => {
  const mail = email();
  const { log, manager } = managed([mail]);
  proposed(log);
  await manager.run();
  log.store.channel_deliveries[0].status = 'pending';
  log.store.channel_deliveries[0].channel = 'carrier-pigeon';
  assert.equal((await manager.run()).failed, 1);
  assert.equal(log.store.channel_deliveries[0].last_error, 'channel_not_registered');
});

test('concurrent runs do not double-send', async () => {
  const slow = email();
  const original = slow.send.bind(slow);
  slow.send = async (p) => { await new Promise((r) => setTimeout(r, 10)); return original(p); };
  const { log, manager } = managed([slow]);
  proposed(log);
  await Promise.all([manager.run(), manager.run()]);
  const perNotification = new Map();
  for (const p of slow.calls) perNotification.set(p.id, (perNotification.get(p.id) ?? 0) + 1);
  assert.ok([...perNotification.values()].every((n) => n === 1));
});

// ---------------------------------------------------------------- direct API for other services
test('deliver() sends an ad-hoc payload through chosen channels without touching the queue', async () => {
  const mail = email(), text = sms();
  const { log, manager } = managed([mail, text]);
  const results = await manager.deliver({ ...INPUT, recipient: { user: U.bob, email: U.bob } });
  assert.deepEqual(results.map((r) => [r.channel, r.result.status]), [['email', 'sent'], ['sms', 'skipped']]);
  assert.equal(results[1].result.reason, 'no_address');
  const only = await manager.deliver({ ...INPUT, recipient: { user: U.bob, email: U.bob, phone: '+14155550123' } }, { channels: ['sms'] });
  assert.deepEqual(only.map((r) => r.channel), ['sms']);
  await assert.rejects(manager.deliver({ ...INPUT, priority: 'urgent' }), /priority/);
  await assert.rejects(manager.deliver(INPUT, { channels: ['fax'] }), /not registered/i);
  assert.equal(log.store.channel_deliveries.length, 0);
});

// ---------------------------------------------------------------- persistence
test('profiles, planning flags and channel deliveries survive a SQLite round trip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-n-'));
  try {
    const file = path.join(dir, 'n.db');
    const box = testBox();
    const clock = makeClock();
    const s1 = SqliteStore.open(file);
    const log = new DecisionLog({ store: s1, clock: clock.now, secretBox: box });
    log.createOwner({ identifier: 'acme' });
    for (const u of [U.alice, U.bob]) log.addTeamMember({ owner: 'acme', user: u, actor: 'acme' });
    log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
    log.setProfile(U.bob, U.bob, { phone: '+14155550123' });
    log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
    act(log, 'PRJ-001', U.alice, 'propose');
    const manager = new NotificationManager(log);
    manager.register(email());
    await manager.run();
    s1.commit(); s1.close();

    const s2 = SqliteStore.open(file);
    const again = new DecisionLog({ store: s2, clock: clock.now, secretBox: box });
    assert.equal(again.getProfile(U.bob, U.bob).phone, '+14155550123');
    assert.ok(s2.channel_deliveries.some((d) => d.status === 'sent'));
    const m2 = new NotificationManager(again);
    m2.register(email());
    assert.equal((await m2.run()).planned, 0, 'already planned notifications are not re-sent after restart');
    s2.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- operational safety
test('old notifications are never sent: enabling a channel later does not blast the backlog', async () => {
  const mail = email();
  const { log, clock, manager } = managed([mail]);
  proposed(log);
  clock.advanceHours(30); // the manager was not running (e.g. SMTP not configured yet)
  const fresh = proposed(log, { title: 'fresh one' });
  const stats = await manager.run();
  assert.ok(mail.calls.length > 0);
  assert.ok(mail.calls.every((p) => p.content.title.startsWith(`[${fresh}]`)), 'only recent notifications are delivered');
  assert.ok(log.store.notifications.every((n) => n.planned), 'stale ones are retired, not left pending');
  assert.equal(stats.planned, log.store.notifications.length);
});

test('pruneChannelDeliveries drops finished rows after the retention window, keeping pending ones', async () => {
  const mail = email([failed('temporary')]);
  const { log, clock, manager } = managed([mail]);
  proposed(log);
  await manager.run(); // everything fails once and stays pending
  clock.advanceDays(40);
  assert.deepEqual(log.pruneChannelDeliveries({ olderThanDays: 30 }), { removed: 0 }, 'pending rows are kept');
  const total = log.store.channel_deliveries.length;
  assert.ok(total > 0);
  log.store.channel_deliveries.forEach((d, i) => { d.status = i % 2 ? 'sent' : 'failed'; });
  assert.deepEqual(log.pruneChannelDeliveries({ olderThanDays: 30 }), { removed: total });
  assert.equal(log.store.channel_deliveries.length, 0);
});
