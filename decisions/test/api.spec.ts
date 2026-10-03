import { describe, it, expect } from 'bun:test';
import { setup, proposed, act, draft, startApi, makeCaller, U, CONTENT_V1, CONTENT_V2 } from './support/index.js';

/** A fresh log + HTTP server for one test. */
async function boot(settings: Record<string, any> = { mode: 'consensus_voting' }, apiOptions: Record<string, any> = {}) {
  const { log, clock } = await setup(settings);
  const { base } = await startApi(log, apiOptions);
  return { log, clock, base, call: makeCaller(base) };
}

const jsonPost = (base: string, body: unknown, user = U.alice, raw = false) =>
  fetch(`${base}/decisions`, { method: 'POST', headers: { 'x-user': user, 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });

describe('requests without X-User are rejected', () => {
  describe('GIVEN a running API', () => {
    describe('WHEN GET /decisions has no X-User', () => {
      it('THEN 401 UNAUTHENTICATED in the failure envelope', async () => {
        // Given
        const { call } = await boot();
        // When
        const r = await call('GET', '/decisions');
        // Then
        expect(r.status).toBe(401);
        expect(r.json.success).toBe(false);
        expect(r.json.error.code).toBe('UNAUTHENTICATED');
      });
    });
  });
});

describe('create and fetch a decision', () => {
  describe('GIVEN a project', () => {
    describe('WHEN alice POSTs /decisions', () => {
      it('THEN 201 and the id is PRJ-001', async () => {
        const { call } = await boot();
        const c = await call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ', title: 'API one', content: CONTENT_V1 } });
        expect(c.status).toBe(201);
        expect(c.json.decision.id).toBe('PRJ-001');
      });
    });
  });

  describe('GIVEN a decision', () => {
    describe('WHEN bob GETs it', () => {
      it('THEN 200 with its title and every collection as an array', async () => {
        const { log, call } = await boot();
        draft(log, { title: 'API one' });
        const g = await call('GET', '/decisions/PRJ-001', { user: U.bob });
        expect(g.status).toBe(200);
        expect(g.json.decision.title).toBe('API one');
        for (const k of ['versions', 'participants', 'comments', 'votes', 'related', 'followups', 'meetings']) {
          expect(Array.isArray(g.json.decision[k]), `missing ${k}`).toBe(true);
        }
      });
    });
    describe('WHEN an outsider GETs it', () => {
      it('THEN 403', async () => {
        const { log, call } = await boot();
        draft(log);
        expect((await call('GET', '/decisions/PRJ-001', { user: U.outsider })).status).toBe(403);
      });
    });
  });

  describe('GIVEN no PRJ-404', () => {
    describe('WHEN bob GETs it', () => {
      it('THEN 404', async () => {
        const { call } = await boot();
        expect((await call('GET', '/decisions/PRJ-404', { user: U.bob })).status).toBe(404);
      });
    });
  });
});

describe('validation and malformed bodies produce 400s in the standard envelope', () => {
  describe('GIVEN a running API', () => {
    describe('WHEN a POST body is not JSON', () => {
      it('THEN 400 INVALID_JSON', async () => {
        const { call } = await boot();
        const bad = await call('POST', '/decisions', { user: U.alice, body: '{not json' });
        expect(bad.status).toBe(400);
        expect(bad.json.error.code).toBe('INVALID_JSON');
      });
    });
    describe('WHEN a decision is POSTed without a title', () => {
      it('THEN 400 VALIDATION_ERROR', async () => {
        const { call } = await boot();
        const miss = await call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ' } });
        expect(miss.status).toBe(400);
        expect(miss.json.error.code).toBe('VALIDATION_ERROR');
      });
    });
    describe('WHEN an unknown route is requested', () => {
      it('THEN 404', async () => {
        const { call } = await boot();
        expect((await call('GET', '/nope', { user: U.alice })).status).toBe(404);
      });
    });
  });
});

describe('unified action endpoint drives the whole lifecycle', () => {
  describe('GIVEN a draft', () => {
    describe('WHEN alice POSTs the propose action', () => {
      it('THEN 200 with the action envelope and a draft-to-proposed transition', async () => {
        // Given
        const { log, call } = await boot();
        draft(log);
        // When
        const p = await call('POST', '/decisions/PRJ-001/actions', { user: U.alice, body: { action: 'propose', payload: {} } });
        // Then
        expect(p.status).toBe(200);
        expect(p.json.success).toBe(true);
        expect(p.json.status_code).toBe(200);
        expect(p.json.action_performed).toBe('propose');
        expect(p.json.decision.status).toBe('proposed');
        expect(p.json.metadata.previous_state).toBe('draft');
        expect(p.json.metadata.timestamp).toBeTruthy();
      });
    });
  });

  describe('GIVEN a proposed decision in consensus mode', () => {
    describe('WHEN bob POSTs a vote', () => {
      it('THEN 200 with a 1-0-0 tally', async () => {
        const { log, call } = await boot();
        proposed(log);
        const v1 = await call('POST', '/decisions/PRJ-001/actions', { user: U.bob, body: { action: 'vote', payload: { vote: 'approve' } } });
        expect(v1.status).toBe(200);
        expect(v1.json.metadata.vote_tally).toEqual({ approve: 1, request_revision: 0, abstain: 0 });
      });
    });
  });

  describe('GIVEN two approvals', () => {
    describe('WHEN david POSTs the third approving vote', () => {
      it('THEN 202 and the decision is approved', async () => {
        const { log, call } = await boot();
        const id = proposed(log);
        act(log, id, U.bob, 'vote', { vote: 'approve' });
        act(log, id, U.carol, 'vote', { vote: 'approve' });
        const v3 = await call('POST', '/decisions/PRJ-001/actions', { user: U.david, body: { action: 'vote', payload: { vote: 'approve' } } });
        expect(v3.status).toBe(202);
        expect(v3.json.decision.status).toBe('approved');
      });
    });
  });
});

describe('errors carry allowed actions and codes', () => {
  describe('GIVEN an approved decision', () => {
    describe('WHEN the lead POSTs propose', () => {
      it('THEN 403 (not the owner)', async () => {
        const { log, call } = await boot();
        const id = proposed(log);
        act(log, id, U.lead, 'approve');
        const r = await call('POST', '/decisions/PRJ-001/actions', { user: U.lead, body: { action: 'propose' } });
        expect(r.status).toBe(403);
      });
    });
  });

  describe('GIVEN a draft', () => {
    describe('WHEN bob POSTs a vote', () => {
      it('THEN 409 INVALID_STATE listing propose, with the attempted action and a timestamp', async () => {
        const { log, call } = await boot();
        draft(log);
        const e = await call('POST', '/decisions/PRJ-001/actions', { user: U.bob, body: { action: 'vote', payload: { vote: 'approve' } } });
        expect(e.status).toBe(409);
        expect(e.json.success).toBe(false);
        expect(e.json.action_attempted).toBe('vote');
        expect(e.json.error.code).toBe('INVALID_STATE');
        expect(e.json.error.allowed_actions.includes('propose')).toBe(true);
        expect(e.json.timestamp).toBeTruthy();
      });
    });
  });

  describe('GIVEN a decision', () => {
    describe('WHEN an action POST has an empty body', () => {
      it('THEN VALIDATION_ERROR', async () => {
        const { log, call } = await boot();
        draft(log);
        expect((await call('POST', '/decisions/PRJ-001/actions', { user: U.bob, body: {} })).json.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });
});

describe('Idempotency-Key is echoed and replays do not repeat side effects', () => {
  const headers = { 'idempotency-key': 'k-1' };
  const body = { action: 'assign_followup', payload: { title: 'once', assigned_to: U.carol, due_date: '2024-06-01' } };

  describe('GIVEN a proposed decision', () => {
    describe('WHEN a follow-up is assigned with Idempotency-Key k-1', () => {
      it('THEN 201, the key is echoed and a request-date is set', async () => {
        const { log, call } = await boot();
        proposed(log);
        const a = await call('POST', '/decisions/PRJ-001/actions', { user: U.alice, body, headers });
        expect(a.status).toBe(201);
        expect(a.headers.get('idempotency-key')).toBe('k-1');
        expect(a.headers.get('request-date')).toBeTruthy();
      });
    });
  });

  describe('GIVEN a follow-up assigned with key k-1', () => {
    describe('WHEN the identical request is replayed', () => {
      it('THEN 201 flagged idempotent_replay with the same follow-up id', async () => {
        const { log, call } = await boot();
        proposed(log);
        const a = await call('POST', '/decisions/PRJ-001/actions', { user: U.alice, body, headers });
        const b = await call('POST', '/decisions/PRJ-001/actions', { user: U.alice, body, headers });
        expect(b.status).toBe(201);
        expect(b.json.idempotent_replay).toBe(true);
        expect(a.json.data.followup.id).toBe(b.json.data.followup.id);
      });
    });
  });
});

describe('comments, participants, versions and diff', () => {
  describe('GIVEN a draft', () => {
    describe('WHEN bob POSTs a comment mentioning @carol', () => {
      it('THEN 201 with carol as the mention', async () => {
        const { log, call } = await boot();
        draft(log);
        const c = await call('POST', '/decisions/PRJ-001/comments', { user: U.bob, body: { content: 'hello @carol' } });
        expect(c.status).toBe(201);
        expect(c.json.comment.mentions).toEqual([U.carol]);
      });
    });
  });

  describe('GIVEN one comment', () => {
    describe('WHEN alice GETs the comments', () => {
      it('THEN there is one', async () => {
        const { log, call } = await boot();
        const d = draft(log);
        log.addComment(d.id, U.bob, { content: 'hello @carol' });
        const list = await call('GET', '/decisions/PRJ-001/comments', { user: U.alice });
        expect(list.json.comments.length).toBe(1);
      });
    });
  });

  describe('GIVEN a comment by bob', () => {
    describe('WHEN alice GETs participants', () => {
      it('THEN they are alice and bob', async () => {
        const { log, call } = await boot();
        const d = draft(log);
        log.addComment(d.id, U.bob, { content: 'hello @carol' });
        const parts = await call('GET', '/decisions/PRJ-001/participants', { user: U.alice });
        expect(parts.json.participants.map((p: any) => p.user).sort()).toEqual([U.alice, U.bob]);
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    describe('WHEN the lead POSTs request_revision', () => {
      it('THEN 201', async () => {
        const { log, call } = await boot();
        proposed(log);
        const rr = await call('POST', '/decisions/PRJ-001/actions', { user: U.lead, body: { action: 'request_revision', payload: { reason: 'timeline' } } });
        expect(rr.status).toBe(201);
      });
    });
  });

  async function twoRevisions() {
    const ctx = await boot();
    const id = proposed(ctx.log);
    act(ctx.log, id, U.lead, 'request_revision', { reason: 'timeline' });
    ctx.log.updateDraft(id, U.alice, { content: CONTENT_V2 });
    act(ctx.log, id, U.alice, 'propose');
    return ctx;
  }

  describe('GIVEN two proposals', () => {
    describe('WHEN bob GETs versions?limit=10', () => {
      it('THEN two versions return', async () => {
        const { call } = await twoRevisions();
        const versions = await call('GET', '/decisions/PRJ-001/versions?limit=10', { user: U.bob });
        expect(versions.json.versions.length).toBe(2);
      });
    });
    describe('WHEN bob GETs diff?from=v1&to=v2', () => {
      it('THEN 200 with a change in the Decision section', async () => {
        const { call } = await twoRevisions();
        const diff = await call('GET', '/decisions/PRJ-001/diff?from=v1&to=v2', { user: U.bob });
        expect(diff.status).toBe(200);
        expect(diff.json.diff.changes.some((x: any) => x.section === 'Decision')).toBe(true);
      });
    });
  });
});

describe('todos, search, reports and listing', () => {
  /** PRJ-001 approved (with a follow-up for carol), PRJ-002 a draft. */
  async function populated() {
    const ctx = await boot();
    const id = proposed(ctx.log);
    for (const u of [U.bob, U.carol, U.david]) act(ctx.log, id, u, 'vote', { vote: 'approve' });
    act(ctx.log, id, U.alice, 'assign_followup', { title: 'once', assigned_to: U.carol, due_date: '2024-06-01' });
    ctx.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'two' });
    return ctx;
  }

  describe('GIVEN a pending follow-up for carol', () => {
    describe('WHEN carol GETs /todos?user=me&status=pending', () => {
      it('THEN 200 with one item', async () => {
        const { call } = await populated();
        const todos = await call('GET', '/todos?user=me&status=pending', { user: U.carol });
        expect(todos.status).toBe(200);
        expect(todos.json.total).toBe(1);
      });
    });
  });

  describe('GIVEN carol\'s todo', () => {
    describe('WHEN bob PATCHes it', () => {
      it('THEN 403', async () => {
        const { call } = await populated();
        const id = (await call('GET', '/todos?user=me&status=pending', { user: U.carol })).json.items[0].id;
        expect((await call('PATCH', `/todos/${id}`, { user: U.bob, body: { status: 'completed' } })).status).toBe(403);
      });
    });
    describe('WHEN carol PATCHes it to completed with notes', () => {
      it('THEN 200 and it is completed', async () => {
        const { call } = await populated();
        const id = (await call('GET', '/todos?user=me&status=pending', { user: U.carol })).json.items[0].id;
        const done = await call('PATCH', `/todos/${id}`, { user: U.carol, body: { status: 'completed', notes: 'done' } });
        expect(done.status).toBe(200);
        expect(done.json.todo.status).toBe('completed');
      });
    });
  });

  describe('GIVEN PRJ-002 exists', () => {
    describe('WHEN alice searches q=PRJ-002', () => {
      it('THEN it is the first hit', async () => {
        const { call } = await populated();
        const s = await call('GET', '/search?q=PRJ-002', { user: U.alice });
        expect(s.json.items[0].decision_id).toBe('PRJ-002');
      });
    });
  });

  describe('GIVEN one approved and one draft decision', () => {
    describe('WHEN alice lists project=PRJ&status=approved&limit=5', () => {
      it('THEN only PRJ-001 returns', async () => {
        const { call } = await populated();
        const list = await call('GET', '/decisions?project=PRJ&status=approved&limit=5', { user: U.alice });
        expect(list.json.items.map((d: any) => d.id)).toEqual(['PRJ-001']);
      });
    });
  });

  describe('GIVEN decisions in March', () => {
    describe('WHEN the org admin GETs /reports/decision_volume', () => {
      it('THEN 200 with by_month', async () => {
        const { call } = await populated();
        const rep = await call('GET', '/reports/decision_volume', { user: U.org });
        expect(rep.status).toBe(200);
        expect(rep.json.report.by_month).toBeTruthy();
      });
    });
  });

  describe('GIVEN a plain member', () => {
    describe('WHEN bob GETs /reports/audit', () => {
      it('THEN 403', async () => {
        const { call } = await populated();
        expect((await call('GET', '/reports/audit', { user: U.bob })).status).toBe(403);
      });
    });
  });
});

describe('admin endpoints create projects and members', () => {
  describe('GIVEN the org admin', () => {
    describe('WHEN POST /teams/members adds zed', () => {
      it('THEN 201', async () => {
        const { call } = await boot();
        const m = await call('POST', '/teams/members', { user: U.org, body: { owner: 'acme', team: 'default', user: 'zed@acme.com', role: 'member' } });
        expect(m.status).toBe(201);
      });
    });
    describe('WHEN POST /projects creates OPS with veto mode', () => {
      it('THEN 201 and the mode is veto', async () => {
        const { call } = await boot();
        const p = await call('POST', '/projects', { user: U.org, body: { owner: 'acme', identifier: 'OPS', title: 'Ops', settings: { approval_settings: { mode: 'veto' } } } });
        expect(p.status).toBe(201);
        expect(p.json.project.approval_settings.mode).toBe('veto');
      });
    });
  });

  describe('GIVEN a plain member', () => {
    describe('WHEN bob POSTs /projects', () => {
      it('THEN 403', async () => {
        const { call } = await boot();
        expect((await call('POST', '/projects', { user: U.bob, body: { owner: 'acme', identifier: 'X', title: 'x' } })).status).toBe(403);
      });
    });
  });
});

describe('serves the web UI without authentication, whitelisted files only', () => {
  describe('GIVEN no credentials', () => {
    describe('WHEN GET /', () => {
      it('THEN 200 text/html titled Decision Log', async () => {
        const { base } = await boot();
        const html = await fetch(`${base}/`);
        expect(html.status).toBe(200);
        expect(html.headers.get('content-type')).toMatch(/text\/html/);
        expect(await html.text()).toMatch(/Decision Log/);
      });
    });
    describe('WHEN GET /app.js', () => {
      it('THEN 200 JavaScript', async () => {
        const { base } = await boot();
        const js = await fetch(`${base}/app.js`);
        expect(js.status).toBe(200);
        expect(js.headers.get('content-type')).toMatch(/javascript/);
      });
    });
    describe('WHEN GET /style.css', () => {
      it('THEN text/css', async () => {
        const { base } = await boot();
        expect((await fetch(`${base}/style.css`)).headers.get('content-type')).toMatch(/text\/css/);
      });
    });
    describe('WHEN GET /favicon.ico', () => {
      it('THEN 204', async () => {
        const { base } = await boot();
        expect((await fetch(`${base}/favicon.ico`)).status).toBe(204);
      });
    });
  });

  describe('GIVEN a path-traversal attempt', () => {
    describe('WHEN GET /..%2Fpackage.json', () => {
      it('THEN 404 because it is not whitelisted', async () => {
        const { base } = await boot();
        expect((await fetch(`${base}/..%2Fpackage.json`)).status).toBe(404);
      });
    });
  });

  describe('GIVEN a file that is not whitelisted', () => {
    describe('WHEN GET /index.html', () => {
      it('THEN 404', async () => {
        const { base } = await boot();
        expect((await fetch(`${base}/index.html`)).status).toBe(404);
      });
    });
  });
});

describe('UI script only uses endpoints the API actually serves', () => {
  describe('GIVEN the served app.js', () => {
    describe('WHEN each top-level endpoint it calls is requested', () => {
      it('THEN none is an unrouted NOT_FOUND', async () => {
        // Given
        const { base, call } = await boot();
        const js = await (await fetch(`${base}/app.js`)).text();
        const used = [...js.matchAll(/api\(['"`](?:GET|POST|PATCH)?['"`]?,?\s*['"`](\/[a-z]+)/g)].map((m) => m[1]);
        expect(used.length).toBeGreaterThan(0);
        // When / Then
        for (const path of new Set(used)) {
          const r = await call('GET', path, { user: U.alice });
          expect(r.json?.error?.code, `${path} is not routed`).not.toBe('NOT_FOUND');
        }
      });
    });
  });
});

describe('onMutation fires after successful writes only', () => {
  async function counting() {
    const calls = { n: 0 };
    const { base } = await boot(undefined, { onMutation: () => { calls.n++; } });
    return { base, calls };
  }

  describe('GIVEN an onMutation hook', () => {
    describe('WHEN a GET succeeds', () => {
      it('THEN the hook does not fire', async () => {
        const { base, calls } = await counting();
        expect((await fetch(`${base}/decisions`, { headers: { 'x-user': U.alice } })).status).toBe(200);
        expect(calls.n).toBe(0);
      });
    });
    describe('WHEN a POST fails validation', () => {
      it('THEN 400 and the hook does not fire', async () => {
        const { base, calls } = await counting();
        expect((await jsonPost(base, { project: 'PRJ' })).status).toBe(400);
        expect(calls.n).toBe(0);
      });
    });
    describe('WHEN a valid POST succeeds', () => {
      it('THEN 201 and the hook fires once', async () => {
        const { base, calls } = await counting();
        expect((await jsonPost(base, { project: 'PRJ', title: 'x' })).status).toBe(201);
        expect(calls.n).toBe(1);
      });
    });
  });
});

describe('webhook management endpoints', () => {
  const body = { owner: 'acme', url: 'https://hooks.example.com/x', events: ['decision.*'] };

  describe('GIVEN a plain member', () => {
    describe('WHEN bob POSTs /webhooks', () => {
      it('THEN 403', async () => {
        const { call } = await boot();
        expect((await call('POST', '/webhooks', { user: U.bob, body })).status).toBe(403);
      });
    });
  });

  describe('GIVEN the org admin', () => {
    describe('WHEN a webhook targets a loopback URL', () => {
      it('THEN 400', async () => {
        const { call } = await boot();
        expect((await call('POST', '/webhooks', { user: U.org, body: { ...body, url: 'http://127.0.0.1/x' } })).status).toBe(400);
      });
    });
    describe('WHEN a valid webhook is POSTed', () => {
      it('THEN 201 with a whsec_ secret', async () => {
        const { call } = await boot();
        const created = await call('POST', '/webhooks', { user: U.org, body });
        expect(created.status).toBe(201);
        expect(created.json.webhook.secret).toMatch(/^whsec_/);
      });
    });
  });

  describe('GIVEN a webhook', () => {
    describe('WHEN the org admin lists webhooks', () => {
      it('THEN one is listed without its secret', async () => {
        const { call } = await boot();
        await call('POST', '/webhooks', { user: U.org, body });
        const list = await call('GET', '/webhooks?owner=acme', { user: U.org });
        expect(list.json.webhooks.length).toBe(1);
        expect('secret' in list.json.webhooks[0]).toBe(false);
      });
    });
    describe('WHEN a plain member lists webhooks', () => {
      it('THEN 403', async () => {
        const { call } = await boot();
        await call('POST', '/webhooks', { user: U.org, body });
        expect((await call('GET', '/webhooks?owner=acme', { user: U.bob })).status).toBe(403);
      });
    });
  });

  async function withDelivery() {
    const ctx = await boot();
    const id = (await ctx.call('POST', '/webhooks', { user: U.org, body })).json.webhook.id;
    await ctx.call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ', title: 'fires a webhook' } });
    return { ...ctx, id };
  }

  describe('GIVEN a decision created after the webhook', () => {
    describe('WHEN deliveries are listed', () => {
      it('THEN the first is decision.created', async () => {
        const { call, id } = await withDelivery();
        const deliveries = await call('GET', `/webhooks/${id}/deliveries`, { user: U.org });
        expect(deliveries.json.items[0].event_type).toBe('decision.created');
      });
    });
  });

  describe('GIVEN a delivery', () => {
    describe('WHEN the org admin POSTs /deliveries/:id/redeliver', () => {
      it('THEN 200', async () => {
        const { call, id } = await withDelivery();
        const deliveries = await call('GET', `/webhooks/${id}/deliveries`, { user: U.org });
        expect((await call('POST', `/deliveries/${deliveries.json.items[0].id}/redeliver`, { user: U.org })).status).toBe(200);
      });
    });
  });

  describe('GIVEN a webhook', () => {
    describe('WHEN the org admin DELETEs it', () => {
      it('THEN 200', async () => {
        const { call, id } = await withDelivery();
        expect((await call('DELETE', `/webhooks/${id}`, { user: U.org })).status).toBe(200);
      });
    });
  });

  describe('GIVEN a deleted webhook', () => {
    describe('WHEN webhooks are listed', () => {
      it('THEN none remain', async () => {
        const { call, id } = await withDelivery();
        await call('DELETE', `/webhooks/${id}`, { user: U.org });
        expect((await call('GET', '/webhooks?owner=acme', { user: U.org })).json.webhooks.length).toBe(0);
      });
    });
  });
});

describe('notification profile endpoints', () => {
  const enc = encodeURIComponent(U.david);
  const configured = async () => {
    const ctx = await boot();
    await ctx.call('PUT', '/profile', { user: U.david, body: { phone: '+14155550123', preferences: { channels: { sms: true }, muted_types: ['mention'] } } });
    return ctx;
  };

  describe('GIVEN david without a stored profile', () => {
    describe('WHEN he GETs /profile', () => {
      it('THEN 200 with his email and email enabled', async () => {
        const { call } = await boot();
        const get = await call('GET', '/profile', { user: U.david });
        expect(get.status).toBe(200);
        expect(get.json.profile.email).toBe(U.david);
        expect(get.json.profile.preferences.channels.email).toBe(true);
      });
    });
  });

  describe('GIVEN david', () => {
    describe('WHEN he PUTs a phone and enables sms', () => {
      it('THEN 200 with the merged profile', async () => {
        const { call } = await boot();
        const put = await call('PUT', '/profile', { user: U.david, body: { phone: '+14155550123', preferences: { channels: { sms: true }, muted_types: ['mention'] } } });
        expect(put.status).toBe(200);
        expect(put.json.profile.phone).toBe('+14155550123');
        expect(put.json.profile.preferences.channels.sms).toBe(true);
      });
    });
    describe('WHEN he PUTs an invalid phone', () => {
      it('THEN 400', async () => {
        const { call } = await boot();
        expect((await call('PUT', '/profile', { user: U.david, body: { phone: 'nope' } })).status).toBe(400);
      });
    });
  });

  describe('GIVEN david\'s profile', () => {
    describe('WHEN carol GETs it by ?user=', () => {
      it('THEN 403', async () => {
        const { call } = await configured();
        expect((await call('GET', `/profile?user=${enc}`, { user: U.carol })).status).toBe(403);
      });
    });
    describe('WHEN the org admin GETs it by ?user=', () => {
      it('THEN it returns his stored phone', async () => {
        const { call } = await configured();
        expect((await call('GET', `/profile?user=${enc}`, { user: U.org })).json.profile.phone).toBe('+14155550123');
      });
    });
    describe('WHEN bob PUTs to it by ?user=', () => {
      it('THEN 403', async () => {
        const { call } = await configured();
        expect((await call('PUT', `/profile?user=${enc}`, { user: U.bob, body: { phone: null } })).status).toBe(403);
      });
    });
  });
});

describe('NUL characters are rejected at the boundary (they cannot be stored in PostgreSQL jsonb)', () => {
  describe('GIVEN a JSON body whose title contains \\u0000', () => {
    describe('WHEN POSTed', () => {
      it('THEN 400 INVALID_JSON', async () => {
        const { base } = await boot();
        const res = await jsonPost(base, '{"project":"PRJ","title":"bad\\u0000title"}', U.alice, true);
        expect(res.status).toBe(400);
        expect((await res.json() as any).error.code).toBe('INVALID_JSON');
      });
    });
  });
});

describe('a failing persistence hook turns into a 500 without leaking details', () => {
  async function failingHook() {
    const { base } = await boot(undefined, { onMutation: async () => { throw new Error('connection to db-prod-7.internal:5432 refused'); } });
    return jsonPost(base, { project: 'PRJ', title: 'x' });
  }

  describe('GIVEN an onMutation hook that throws', () => {
    describe('WHEN a decision is POSTed', () => {
      it('THEN 500 INTERNAL_ERROR', async () => {
        const res = await failingHook();
        expect(res.status).toBe(500);
        expect((await res.json() as any).error.code).toBe('INTERNAL_ERROR');
      });

      it('THEN the response does not leak the internal host', async () => {
        const res = await failingHook();
        expect(JSON.stringify(await res.json()).includes('db-prod-7')).toBe(false);
      });
    });
  });
});
