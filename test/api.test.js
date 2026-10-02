import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/api.js';
import { setup, CONTENT_V1, CONTENT_V2, U } from './helpers.js';

let server, base, log;

before(async () => {
  ({ log } = setup({ mode: 'consensus_voting' }));
  server = createApp(log);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

async function call(method, path, { user, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

test('requests without X-User are rejected', async () => {
  const r = await call('GET', '/decisions');
  assert.equal(r.status, 401);
  assert.equal(r.json.success, false);
  assert.equal(r.json.error.code, 'UNAUTHENTICATED');
});

test('create and fetch a decision', async () => {
  const c = await call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ', title: 'API one', content: CONTENT_V1 } });
  assert.equal(c.status, 201);
  assert.equal(c.json.decision.id, 'PRJ-001');
  const g = await call('GET', '/decisions/PRJ-001', { user: U.bob });
  assert.equal(g.status, 200);
  assert.equal(g.json.decision.title, 'API one');
  for (const k of ['versions', 'participants', 'comments', 'votes', 'related', 'followups', 'meetings']) {
    assert.ok(Array.isArray(g.json.decision[k]), `missing ${k}`);
  }
  assert.equal((await call('GET', '/decisions/PRJ-001', { user: U.outsider })).status, 403);
  assert.equal((await call('GET', '/decisions/PRJ-404', { user: U.bob })).status, 404);
});

test('validation and malformed bodies produce 400s in the standard envelope', async () => {
  const bad = await call('POST', '/decisions', { user: U.alice, body: '{not json' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'INVALID_JSON');
  const miss = await call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ' } });
  assert.equal(miss.status, 400);
  assert.equal(miss.json.error.code, 'VALIDATION_ERROR');
  assert.equal((await call('GET', '/nope', { user: U.alice })).status, 404);
});

test('unified action endpoint drives the whole lifecycle', async () => {
  const p = await call('POST', '/decisions/PRJ-001/actions', { user: U.alice, body: { action: 'propose', payload: {} } });
  assert.equal(p.status, 200);
  assert.equal(p.json.success, true);
  assert.equal(p.json.status_code, 200);
  assert.equal(p.json.action_performed, 'propose');
  assert.equal(p.json.decision.status, 'proposed');
  assert.equal(p.json.metadata.previous_state, 'draft');
  assert.ok(p.json.metadata.timestamp);

  const v1 = await call('POST', '/decisions/PRJ-001/actions', { user: U.bob, body: { action: 'vote', payload: { vote: 'approve' } } });
  assert.equal(v1.status, 200);
  assert.deepEqual(v1.json.metadata.vote_tally, { approve: 1, request_revision: 0, abstain: 0 });
  await call('POST', '/decisions/PRJ-001/actions', { user: U.carol, body: { action: 'vote', payload: { vote: 'approve' } } });
  const v3 = await call('POST', '/decisions/PRJ-001/actions', { user: U.david, body: { action: 'vote', payload: { vote: 'approve' } } });
  assert.equal(v3.status, 202);
  assert.equal(v3.json.decision.status, 'approved');
});

test('errors carry allowed actions and codes', async () => {
  const r = await call('POST', '/decisions/PRJ-001/actions', { user: U.lead, body: { action: 'propose' } });
  assert.equal(r.status, 403);
  const d = await call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ', title: 'two' } });
  const e = await call('POST', `/decisions/${d.json.decision.id}/actions`, { user: U.bob, body: { action: 'vote', payload: { vote: 'approve' } } });
  assert.equal(e.status, 409);
  assert.equal(e.json.success, false);
  assert.equal(e.json.action_attempted, 'vote');
  assert.equal(e.json.error.code, 'INVALID_STATE');
  assert.ok(e.json.error.allowed_actions.includes('propose'));
  assert.ok(e.json.timestamp);
  assert.equal((await call('POST', `/decisions/PRJ-002/actions`, { user: U.bob, body: {} })).json.error.code, 'VALIDATION_ERROR');
});

test('Idempotency-Key is echoed and replays do not repeat side effects', async () => {
  const headers = { 'idempotency-key': 'k-1' };
  const body = { action: 'assign_followup', payload: { title: 'once', assigned_to: U.carol, due_date: '2024-06-01' } };
  const a = await call('POST', '/decisions/PRJ-001/actions', { user: U.alice, body, headers });
  const b = await call('POST', '/decisions/PRJ-001/actions', { user: U.alice, body, headers });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.headers.get('idempotency-key'), 'k-1');
  assert.ok(a.headers.get('request-date'));
  assert.equal(b.json.idempotent_replay, true);
  assert.equal(a.json.data.followup.id, b.json.data.followup.id);
});

test('comments, participants, versions and diff', async () => {
  const c = await call('POST', '/decisions/PRJ-002/comments', { user: U.bob, body: { content: 'hello @carol' } });
  assert.equal(c.status, 201);
  assert.deepEqual(c.json.comment.mentions, [U.carol]);
  const list = await call('GET', '/decisions/PRJ-002/comments', { user: U.alice });
  assert.equal(list.json.comments.length, 1);
  const parts = await call('GET', '/decisions/PRJ-002/participants', { user: U.alice });
  assert.deepEqual(parts.json.participants.map((p) => p.user).sort(), [U.alice, U.bob]);

  await call('POST', '/decisions/PRJ-002/actions', { user: U.alice, body: { action: 'propose', payload: { content: CONTENT_V1 } } });
  const rr = await call('POST', '/decisions/PRJ-002/actions', { user: U.lead, body: { action: 'request_revision', payload: { reason: 'timeline' } } });
  assert.equal(rr.status, 201);
  log.updateDraft('PRJ-002', U.alice, { content: CONTENT_V2 });
  await call('POST', '/decisions/PRJ-002/actions', { user: U.alice, body: { action: 'propose' } });
  const versions = await call('GET', '/decisions/PRJ-002/versions?limit=10', { user: U.bob });
  assert.equal(versions.json.versions.length, 2);
  const diff = await call('GET', '/decisions/PRJ-002/diff?from=v1&to=v2', { user: U.bob });
  assert.equal(diff.status, 200);
  assert.ok(diff.json.diff.changes.some((x) => x.section === 'Decision'));
});

test('todos, search, reports and listing', async () => {
  const todos = await call('GET', '/todos?user=me&status=pending', { user: U.carol });
  assert.equal(todos.status, 200);
  assert.equal(todos.json.total, 1);
  const id = todos.json.items[0].id;
  assert.equal((await call('PATCH', `/todos/${id}`, { user: U.bob, body: { status: 'completed' } })).status, 403);
  const done = await call('PATCH', `/todos/${id}`, { user: U.carol, body: { status: 'completed', notes: 'done' } });
  assert.equal(done.status, 200);
  assert.equal(done.json.todo.status, 'completed');

  const s = await call('GET', '/search?q=PRJ-002', { user: U.alice });
  assert.equal(s.json.items[0].decision_id, 'PRJ-002');
  const list = await call('GET', '/decisions?project=PRJ&status=approved&limit=5', { user: U.alice });
  assert.deepEqual(list.json.items.map((d) => d.id), ['PRJ-001']);
  const rep = await call('GET', '/reports/decision_volume', { user: U.org });
  assert.equal(rep.status, 200);
  assert.ok(rep.json.report.by_month);
  assert.equal((await call('GET', '/reports/audit', { user: U.bob })).status, 403);
});

test('admin endpoints create projects and members', async () => {
  const m = await call('POST', '/teams/members', { user: U.org, body: { owner: 'acme', team: 'default', user: 'zed@acme.com', role: 'member' } });
  assert.equal(m.status, 201);
  const p = await call('POST', '/projects', { user: U.org, body: { owner: 'acme', identifier: 'OPS', title: 'Ops', settings: { approval_settings: { mode: 'veto' } } } });
  assert.equal(p.status, 201);
  assert.equal(p.json.project.approval_settings.mode, 'veto');
  assert.equal((await call('POST', '/projects', { user: U.bob, body: { owner: 'acme', identifier: 'X', title: 'x' } })).status, 403);
});

test('serves the web UI without authentication, whitelisted files only', async () => {
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(await html.text(), /Decision Log/);
  const js = await fetch(`${base}/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const css = await fetch(`${base}/style.css`);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.equal((await fetch(`${base}/favicon.ico`)).status, 204);
  const sneaky = await fetch(`${base}/..%2Fpackage.json`);
  assert.equal(sneaky.status, 404, 'not whitelisted, so it is an unknown route');
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
});

test('UI script only uses endpoints the API actually serves', async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  const used = [...js.matchAll(/api\(['"`](?:GET|POST|PATCH)?['"`]?,?\s*['"`](\/[a-z]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const path of new Set(used)) {
    const r = await call('GET', path, { user: U.alice });
    assert.notEqual(r.json?.error?.code, 'NOT_FOUND', `${path} is not routed`);
  }
});

test('onMutation fires after successful writes only', async () => {
  const { log: l2 } = setup();
  let calls = 0;
  const s2 = createApp(l2, { onMutation: () => { calls++; } });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  const post = (body, user = U.alice) => fetch(`${b2}/decisions`, { method: 'POST', headers: { 'x-user': user, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${b2}/decisions`, { headers: { 'x-user': U.alice } })).status, 200);
  assert.equal((await post({ project: 'PRJ' })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await post({ project: 'PRJ', title: 'x' })).status, 201);
  assert.equal(calls, 1);
  await new Promise((r) => s2.close(r));
});
