import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebhookDispatcher, verifySignature } from '../src/webhooks.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { DecisionLog } from '../src/decision-log.js';
import { setup, draft, proposed, act, assertCode, makeClock, U } from './helpers.js';

const URL_OK = 'https://hooks.example.com/dl';
const PUBLIC = async () => ['93.184.216.34'];

function recorder(statuses = [200]) {
  const calls = [];
  let i = 0;
  const transport = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s instanceof Error) throw s;
    return { status: s };
  };
  return { calls, transport };
}

function hooked(settings, events = ['*']) {
  const ctx = setup(settings);
  const hook = ctx.log.createWebhook({ owner: 'acme', url: URL_OK, events, actor: U.org });
  return { ...ctx, hook };
}

const dispatcherFor = (log, rec, extra = {}) => new WebhookDispatcher(log, { transport: rec.transport, resolve: PUBLIC, ...extra });

// ---------------------------------------------------------------- registration
test('org admins register webhooks; the secret is shown once and never listed', () => {
  const { log } = setup();
  const hook = log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.*'], actor: U.org });
  assert.match(hook.secret, /^whsec_[0-9a-f]{48}$/);
  assert.deepEqual(hook.events, ['decision.*']);
  assert.equal(hook.active, true);
  const listed = log.listWebhooks('acme', U.org);
  assert.equal(listed.length, 1);
  assert.equal('secret' in listed[0], false);
  assert.equal(log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org }).events[0], '*', 'defaults to all events');
  assertCode(() => log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.lead }), 'FORBIDDEN', 403);
  assertCode(() => log.listWebhooks('acme', U.bob), 'FORBIDDEN', 403);
});

test('webhook URLs and event filters are validated', () => {
  const { log } = setup();
  const bad = (url, events) => assertCode(() => log.createWebhook({ owner: 'acme', url, events, actor: U.org }), 'VALIDATION_ERROR', 400);
  for (const url of ['ftp://hooks.example.com', 'not a url', 'https://user:pw@hooks.example.com/x', 'http://127.0.0.1/x',
    'http://localhost:3000/x', 'http://10.1.2.3/x', 'http://192.168.0.5/x', 'http://172.16.0.1/x', 'http://[::1]/x',
    'http://169.254.169.254/latest/meta-data', 'http://service.internal/x']) bad(url);
  bad(URL_OK, ['decision.exploded']);
  bad(URL_OK, ['nope.*']);
  bad(URL_OK, []);
  bad(URL_OK, 'decision.created');
  log.allowPrivateTargets = true;
  assert.ok(log.createWebhook({ owner: 'acme', url: 'http://localhost:9000/hook', actor: U.org }));
});

test('webhooks can be removed by admins only; removed hooks disappear from listings', () => {
  const { log, hook } = hooked();
  assertCode(() => log.deleteWebhook(hook.id, U.lead), 'FORBIDDEN', 403);
  log.deleteWebhook(hook.id, U.org);
  assert.deepEqual(log.listWebhooks('acme', U.org), []);
  assertCode(() => log.deleteWebhook('webhook-999', U.org), 'NOT_FOUND', 404);
});

// ---------------------------------------------------------------- events
test('events are recorded in the outbox and fan out to matching active hooks of the same org only', () => {
  const { log } = setup();
  const all = log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org });
  const approvedOnly = log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.approved'], actor: U.org });
  const removed = log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org });
  log.deleteWebhook(removed.id, U.org);
  log.createOwner({ identifier: 'other' });
  const foreign = log.createWebhook({ owner: 'other', url: URL_OK, actor: 'other' });

  const id = proposed(log);
  assert.deepEqual(log.store.events.map((e) => e.type), ['decision.created', 'decision.proposed']);
  const types = (hook, actor = U.org) => log.listDeliveries(hook.id, actor).items.map((d) => d.event_type).sort();
  assert.deepEqual(types(all), ['decision.created', 'decision.proposed']);
  assert.deepEqual(types(approvedOnly), []);
  assert.deepEqual(types(foreign, 'other'), []);
  act(log, id, U.lead, 'approve');
  assert.deepEqual(types(approvedOnly), ['decision.approved']);
});

test('wildcard family filters match', () => {
  const { log } = setup();
  const decisionOnly = log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.*'], actor: U.org });
  const id = proposed(log);
  log.addComment(id, U.bob, { content: 'hi' });
  assert.equal(log.listDeliveries(decisionOnly.id, U.org).total, 2, 'comment.created is not in the decision.* family');
});

test('vote and approval events carry the documented payload', () => {
  const { log } = hooked({ mode: 'consensus_voting' });
  const id = proposed(log);
  for (const u of [U.bob, U.carol, U.david]) act(log, id, u, 'vote', { vote: 'approve', comment: 'ok' });
  const events = log.store.events;
  const vote = events.find((e) => e.type === 'decision.vote_received');
  assert.equal(vote.payload.event, 'decision.vote_received');
  assert.equal(vote.payload.decision_id, id);
  assert.equal(vote.payload.voter, U.bob);
  assert.equal(vote.payload.vote, 'approve');
  assert.match(vote.payload.timestamp, /^2024-03-20T/);
  assert.equal(vote.payload.id, vote.id);
  const approved = events.at(-1);
  assert.equal(approved.type, 'decision.approved');
  assert.deepEqual(approved.payload.approvers.sort(), [U.bob, U.carol, U.david]);
  assert.ok(events.indexOf(vote) < events.indexOf(approved));
  assert.equal(JSON.stringify(events).includes('"content"'), false, 'documents and comment bodies are not leaked');
});

test('every lifecycle step emits its event', () => {
  const { log } = hooked();
  const id = proposed(log);
  act(log, id, U.lead, 'request_revision', { reason: 'more detail' });
  act(log, id, U.alice, 'propose');
  act(log, id, U.lead, 'decline', { reason: 'no' });
  act(log, id, U.alice, 'return_to_draft');
  act(log, id, U.alice, 'propose');
  act(log, id, U.lead, 'approve');
  act(log, id, U.bob, 'assign_followup', { title: 't', assigned_to: U.carol });
  const todo = log.listTodos({ user: U.carol }).items[0];
  log.updateTodo(todo.id, U.carol, { status: 'completed' });
  act(log, id, U.bob, 'add_meeting', { transcript_text: 'we met' });
  const next = act(log, id, U.bob, 'create_superseding_decision', { title: 'v2' }).decision;
  act(log, next.id, U.bob, 'propose');
  act(log, next.id, U.lead, 'approve');
  const types = new Set(log.store.events.map((e) => e.type));
  for (const t of ['decision.created', 'decision.proposed', 'decision.revision_requested', 'decision.declined', 'decision.returned_to_draft',
    'decision.approved', 'followup.assigned', 'followup.completed', 'meeting.recorded', 'decision.superseded']) {
    assert.ok(types.has(t), `missing ${t}`);
  }
});

test('failed actions emit nothing', () => {
  const { log } = hooked();
  const d = draft(log);
  const before = log.store.events.length;
  assertCode(() => act(log, d.id, U.bob, 'propose'), 'FORBIDDEN');
  assertCode(() => act(log, d.id, U.lead, 'approve'), 'INVALID_STATE');
  assert.equal(log.store.events.length, before);
});

// ---------------------------------------------------------------- delivery
test('dispatcher POSTs signed JSON and marks deliveries delivered', async () => {
  const { log, clock, hook } = hooked(undefined, ['decision.*']);
  proposed(log);
  const rec = recorder();
  const result = await dispatcherFor(log, rec).run();
  assert.deepEqual(result, { attempted: 2, delivered: 2, failed: 0, retrying: 0 });
  const first = rec.calls[0];
  assert.equal(first.url, URL_OK);
  assert.equal(first.init.method, 'POST');
  const h = first.init.headers;
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h['x-decision-log-event'], 'decision.created');
  assert.match(h['x-decision-log-delivery'], /^dlv-\d+$/);
  assert.equal(first.init.redirect, 'manual');
  assert.equal(verifySignature({ secret: hook.secret, timestamp: h['x-decision-log-timestamp'], body: first.init.body, signature: h['x-decision-log-signature'], now: clock.now() }), true);
  const d = log.listDeliveries(hook.id, U.org).items[0];
  assert.equal(d.status, 'delivered');
  assert.equal(d.attempts, 1);
  assert.equal(d.last_status, 200);
  assert.ok(d.delivered_at);
  assert.deepEqual(await dispatcherFor(log, rec).run(), { attempted: 0, delivered: 0, failed: 0, retrying: 0 });
});

test('failures retry with exponential backoff and give up after five attempts', async () => {
  const { log, clock, hook } = hooked(undefined, ['decision.created']);
  draft(log);
  const rec = recorder([500]);
  const dispatcher = dispatcherFor(log, rec);
  const state = () => log.listDeliveries(hook.id, U.org).items[0];

  assert.equal((await dispatcher.run()).retrying, 1);
  assert.equal(state().status, 'pending');
  assert.equal(state().attempts, 1);
  assert.equal(state().last_status, 500);
  assert.equal(state().next_attempt_at, '2024-03-20T10:01:00.000Z');
  await dispatcher.run();
  assert.equal(rec.calls.length, 1, 'not due yet');
  clock.advanceMinutes(2);
  await dispatcher.run();
  assert.equal(state().next_attempt_at, '2024-03-20T10:07:00.000Z', '+5 minutes from the second failure');
  for (let i = 0; i < 5; i++) { clock.advanceHours(13); await dispatcher.run(); }
  assert.equal(state().status, 'failed');
  assert.equal(state().attempts, 5);
  assert.equal(rec.calls.length, 5);
});

test('transport errors are recorded and retried; recovery marks delivered', async () => {
  const { log, clock, hook } = hooked(undefined, ['decision.created']);
  draft(log);
  const rec = recorder([new Error('ECONNREFUSED'), 204]);
  const dispatcher = dispatcherFor(log, rec);
  await dispatcher.run();
  let d = log.listDeliveries(hook.id, U.org).items[0];
  assert.equal(d.last_status, null);
  assert.match(d.last_error, /ECONNREFUSED/);
  clock.advanceMinutes(2);
  await dispatcher.run();
  d = log.listDeliveries(hook.id, U.org).items[0];
  assert.equal(d.status, 'delivered');
  assert.equal(d.last_error, null);
});

test('redirects count as failures; they are never followed', async () => {
  const { log, hook } = hooked(undefined, ['decision.created']);
  draft(log);
  await dispatcherFor(log, recorder([302])).run();
  assert.equal(log.listDeliveries(hook.id, U.org).items[0].status, 'pending');
});

test('failed deliveries can be redelivered by admins', async () => {
  const { log, clock, hook } = hooked(undefined, ['decision.created']);
  draft(log);
  const rec = recorder([500, 500, 500, 500, 500, 200]);
  const dispatcher = dispatcherFor(log, rec);
  for (let i = 0; i < 5; i++) { await dispatcher.run(); clock.advanceHours(13); }
  const { id } = log.listDeliveries(hook.id, U.org).items[0];
  assert.equal(log.listDeliveries(hook.id, U.org, { status: 'failed' }).total, 1);
  assertCode(() => log.redeliver(id, U.lead), 'FORBIDDEN', 403);
  assert.equal(log.redeliver(id, U.org).status, 'pending');
  await dispatcher.run();
  assert.equal(log.listDeliveries(hook.id, U.org).items[0].status, 'delivered');
  assertCode(() => log.redeliver('dlv-999', U.org), 'NOT_FOUND', 404);
});

test('deliveries to removed hooks are cancelled, not sent', async () => {
  const { log, hook } = hooked(undefined, ['decision.created']);
  draft(log);
  log.deleteWebhook(hook.id, U.org);
  const rec = recorder();
  await dispatcherFor(log, rec).run();
  assert.equal(rec.calls.length, 0);
  assert.equal(log.store.deliveries[0].status, 'cancelled');
});

test('concurrent runs do not double-send', async () => {
  const { log } = hooked(undefined, ['decision.created']);
  draft(log);
  const rec = recorder();
  const slow = async (...a) => { await new Promise((r) => setTimeout(r, 20)); return rec.transport(...a); };
  const dispatcher = new WebhookDispatcher(log, { transport: slow, resolve: PUBLIC });
  await Promise.all([dispatcher.run(), dispatcher.run()]);
  assert.equal(rec.calls.length, 1);
});

// ---------------------------------------------------------------- SSRF
test('delivery refuses targets that resolve to private addresses', async () => {
  const { log, hook } = hooked(undefined, ['decision.created']);
  draft(log);
  const rec = recorder();
  for (const addrs of [['10.0.0.5'], ['93.184.216.34', '127.0.0.1'], ['::1'], ['::ffff:192.168.1.1'], ['169.254.169.254']]) {
    log.store.deliveries[0].status = 'pending';
    log.store.deliveries[0].attempts = 0;
    await new WebhookDispatcher(log, { transport: rec.transport, resolve: async () => addrs }).run();
    const d = log.listDeliveries(hook.id, U.org).items[0];
    assert.equal(d.status, 'failed', addrs.join());
    assert.equal(d.last_error, 'blocked_target');
  }
  assert.equal(rec.calls.length, 0);
  log.store.deliveries[0].status = 'pending';
  await new WebhookDispatcher(log, { transport: rec.transport, resolve: async () => ['10.0.0.5'], allowPrivateTargets: true }).run();
  assert.equal(rec.calls.length, 1);
});

// ---------------------------------------------------------------- signatures
test('verifySignature accepts valid signatures and rejects tampering, wrong secrets and stale timestamps', async () => {
  const { log, clock, hook } = hooked(undefined, ['decision.created']);
  draft(log);
  const rec = recorder();
  await dispatcherFor(log, rec).run();
  const { init } = rec.calls[0];
  const h = init.headers;
  const base = { secret: hook.secret, timestamp: h['x-decision-log-timestamp'], body: init.body, signature: h['x-decision-log-signature'], now: clock.now() };
  assert.equal(verifySignature(base), true);
  assert.equal(verifySignature({ ...base, body: `${init.body} ` }), false);
  assert.equal(verifySignature({ ...base, secret: 'whsec_wrong' }), false);
  assert.equal(verifySignature({ ...base, signature: 'sha256=abc' }), false);
  assert.equal(verifySignature({ ...base, signature: 'garbage' }), false);
  assert.equal(verifySignature({ ...base, signature: undefined }), false);
  clock.advanceMinutes(10);
  assert.equal(verifySignature({ ...base, now: clock.now() }), false, 'older than the 5 minute tolerance');
  assert.equal(verifySignature({ ...base, now: clock.now(), toleranceSeconds: 3600 }), true);
});

// ---------------------------------------------------------------- persistence
test('webhooks, events and deliveries survive a SQLite round trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-wh-'));
  try {
    const file = path.join(dir, 'x.db');
    const s1 = SqliteStore.open(file);
    const clock = makeClock();
    const log = new DecisionLog({ store: s1, clock: clock.now });
    log.createOwner({ identifier: 'acme' });
    log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
    log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
    const hook = log.createWebhook({ owner: 'acme', url: URL_OK, actor: 'acme' });
    log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
    s1.commit();
    s1.close();

    const s2 = SqliteStore.open(file);
    const again = new DecisionLog({ store: s2, clock: clock.now });
    assert.equal(again.listWebhooks('acme', 'acme').length, 1);
    assert.equal(again.listDeliveries(hook.id, 'acme').total, 1);
    again.createDecision({ project: 'PRJ', actor: U.alice, title: 'y' });
    assert.deepEqual(again.store.events.map((e) => e.id), ['evt-001', 'evt-002']);
    s2.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- end to end & housekeeping
test('end to end over real HTTP: a local receiver verifies the signature', async () => {
  const http = await import('node:http');
  const received = [];
  const receiver = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ headers: req.headers, body: Buffer.concat(chunks).toString() }); res.writeHead(204); res.end(); });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  try {
    const { log, hook } = (() => {
      const ctx = setup();
      ctx.log.allowPrivateTargets = true;
      const h = ctx.log.createWebhook({ owner: 'acme', url: `http://127.0.0.1:${receiver.address().port}/hook`, events: ['decision.created'], actor: U.org });
      return { log: ctx.log, hook: h };
    })();
    draft(log);
    const stats = await new WebhookDispatcher(log, { allowPrivateTargets: true }).run();
    assert.equal(stats.delivered, 1);
    assert.equal(received.length, 1);
    const { headers, body } = received[0];
    assert.equal(headers['x-decision-log-event'], 'decision.created');
    assert.equal(JSON.parse(body).decision_id, 'PRJ-001');
    assert.equal(verifySignature({ secret: hook.secret, timestamp: headers['x-decision-log-timestamp'], body, signature: headers['x-decision-log-signature'], now: log.clock() }), true);
  } finally { await new Promise((r) => receiver.close(r)); }
});

test('default policy refuses a loopback receiver at delivery time', async () => {
  const { log, hook } = hooked(undefined, ['decision.created']);
  log.store.webhooks[0].url = 'http://127.0.0.1:9/hook'; // bypass creation-time validation, as if DNS changed later
  draft(log);
  const stats = await new WebhookDispatcher(log, { transport: () => assert.fail('must not send') }).run();
  assert.equal(stats.failed, 1);
  assert.equal(log.listDeliveries(hook.id, U.org).items[0].last_error, 'blocked_target');
});

test('pruneOutbox removes old finished deliveries and orphaned events, keeping pending ones', async () => {
  const { log, clock } = hooked(undefined, ['decision.created']);
  draft(log);
  await dispatcherFor(log, recorder()).run();
  clock.advanceDays(10);
  draft(log, { title: 'recent, still pending' });
  const removed = log.pruneOutbox({ olderThanDays: 7 });
  assert.deepEqual(removed, { deliveries: 1, events: 1 });
  assert.equal(log.store.deliveries.length, 1);
  assert.equal(log.store.deliveries[0].status, 'pending');
  assert.equal(log.store.events.length, 1);
  clock.advanceDays(30);
  assert.deepEqual(log.pruneOutbox({ olderThanDays: 7 }), { deliveries: 0, events: 0 }, 'pending deliveries are never pruned');
});
