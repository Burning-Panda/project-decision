import { describe, it, expect, beforeEach } from 'bun:test';
import { setup, proposed, act, draft, startApi, makeCaller, U, CONTENT_V1, CONTENT_V2, type LogHandle } from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one request (beforeEach), THEN only asserts.
// Every THEN runs against a freshly built log and API.
// Routing, authentication and public assets are covered by routes.spec.ts; this spec covers behaviour over HTTP.

type Caller = ReturnType<typeof makeCaller>;
type Reply = Awaited<ReturnType<Caller>>;
type Api = LogHandle & { base: string; call: Caller };

/** Call inside a describe(): a fresh log (consensus mode by default) served over HTTP before each test. */
function runningApi(settings: Record<string, any> = { mode: 'consensus_voting' }, apiOptions: Record<string, any> = {}): Api {
  const h = {} as Api;
  beforeEach(async () => {
    Object.assign(h, await setup(settings));
    h.base = (await startApi(h.log, apiOptions)).base;
    h.call = makeCaller(h.base);
  });
  return h;
}

/** POST /decisions with a JSON (or, with raw, a pre-serialised) body; returns the parsed reply. */
async function postDecision(base: string, body: unknown, { user = U.alice, raw = false } = {}) {
  const res = await fetch(`${base}/decisions`, {
    method: 'POST', headers: { 'x-user': user, 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, text };
}

const actions = (call: Caller, user: string, body: unknown, headers: Record<string, string> = {}) =>
  call('POST', '/decisions/PRJ-001/actions', { user, body, headers });

describe('create and fetch a decision', () => {
  describe('GIVEN a project', () => {
    const api = runningApi();

    describe('WHEN alice POSTs /decisions', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ', title: 'API one', content: CONTENT_V1 } }); });

      it('THEN 201 and the id is PRJ-001', () => {
        expect(r.status).toBe(201);
        expect(r.json.decision.id).toBe('PRJ-001');
      });
    });

    describe('WHEN bob GETs PRJ-404, which does not exist', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-404', { user: U.bob }); });

      it('THEN 404', () => {
        expect(r.status).toBe(404);
      });
    });
  });

  describe('GIVEN a decision titled API one', () => {
    const api = runningApi();
    beforeEach(() => { draft(api.log, { title: 'API one' }); });

    describe('WHEN bob GETs it', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001', { user: U.bob }); });

      it('THEN 200 with its title and every collection as an array', () => {
        expect(r.status).toBe(200);
        expect(r.json.decision.title).toBe('API one');
        for (const k of ['versions', 'participants', 'comments', 'votes', 'related', 'followups', 'meetings']) {
          expect(Array.isArray(r.json.decision[k]), `missing ${k}`).toBe(true);
        }
      });
    });

    describe('WHEN an outsider GETs it', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001', { user: U.outsider }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });
  });
});

describe('validation and malformed bodies produce 400s in the standard envelope', () => {
  describe('GIVEN a running API', () => {
    const api = runningApi();

    describe('WHEN a POST body is not JSON', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/decisions', { user: U.alice, body: '{not json' }); });

      it('THEN 400 INVALID_JSON', () => {
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe('INVALID_JSON');
      });
    });

    describe('WHEN a decision is POSTed without a title', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ' } }); });

      it('THEN 400 VALIDATION_ERROR', () => {
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });
});

describe('unified action endpoint drives the whole lifecycle', () => {
  describe('GIVEN a draft', () => {
    const api = runningApi();
    beforeEach(() => { draft(api.log); });

    describe('WHEN alice POSTs the propose action', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.alice, { action: 'propose', payload: {} }); });

      it('THEN 200 with the action envelope and a draft-to-proposed transition', () => {
        expect(r.status).toBe(200);
        expect(r.json.success).toBe(true);
        expect(r.json.status_code).toBe(200);
        expect(r.json.action_performed).toBe('propose');
        expect(r.json.decision.status).toBe('proposed');
        expect(r.json.metadata.previous_state).toBe('draft');
        expect(r.json.metadata.timestamp).toBeTruthy();
      });
    });
  });

  describe('GIVEN a proposed decision in consensus mode', () => {
    const api = runningApi();
    beforeEach(() => { proposed(api.log); });

    describe('WHEN bob POSTs a vote', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.bob, { action: 'vote', payload: { vote: 'approve' } }); });

      it('THEN 200 with a 1-0-0 tally', () => {
        expect(r.status).toBe(200);
        expect(r.json.metadata.vote_tally).toEqual({ approve: 1, request_revision: 0, abstain: 0 });
      });
    });
  });

  describe('GIVEN two approvals', () => {
    const api = runningApi();
    beforeEach(() => {
      const id = proposed(api.log);
      act(api.log, id, U.bob, 'vote', { vote: 'approve' });
      act(api.log, id, U.carol, 'vote', { vote: 'approve' });
    });

    describe('WHEN david POSTs the third approving vote', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.david, { action: 'vote', payload: { vote: 'approve' } }); });

      it('THEN 202 and the decision is approved', () => {
        expect(r.status).toBe(202);
        expect(r.json.decision.status).toBe('approved');
      });
    });
  });
});

describe('errors carry allowed actions and codes', () => {
  describe('GIVEN an approved decision', () => {
    const api = runningApi();
    beforeEach(() => { act(api.log, proposed(api.log), U.lead, 'approve'); });

    describe('WHEN the lead POSTs propose', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.lead, { action: 'propose' }); });

      it('THEN 403 (not the owner)', () => {
        expect(r.status).toBe(403);
      });
    });
  });

  describe('GIVEN a draft', () => {
    const api = runningApi();
    beforeEach(() => { draft(api.log); });

    describe('WHEN bob POSTs a vote', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.bob, { action: 'vote', payload: { vote: 'approve' } }); });

      it('THEN 409 INVALID_STATE listing propose, with the attempted action and a timestamp', () => {
        expect(r.status).toBe(409);
        expect(r.json.success).toBe(false);
        expect(r.json.action_attempted).toBe('vote');
        expect(r.json.error.code).toBe('INVALID_STATE');
        expect(r.json.error.allowed_actions).toContain('propose');
        expect(r.json.timestamp).toBeTruthy();
      });
    });

    describe('WHEN an action POST has an empty body', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.bob, {}); });

      it('THEN VALIDATION_ERROR', () => {
        expect(r.json.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });
});

describe('Idempotency-Key is echoed and replays do not repeat side effects', () => {
  const KEY = { 'idempotency-key': 'k-1' };
  const ASSIGN = { action: 'assign_followup', payload: { title: 'once', assigned_to: U.carol, due_date: '2024-06-01' } };

  describe('GIVEN a proposed decision', () => {
    const api = runningApi();
    beforeEach(() => { proposed(api.log); });

    describe('WHEN a follow-up is assigned with Idempotency-Key k-1', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.alice, ASSIGN, KEY); });

      it('THEN 201, the key is echoed and a request-date is set', () => {
        expect(r.status).toBe(201);
        expect(r.headers.get('idempotency-key')).toBe('k-1');
        expect(r.headers.get('request-date')).toBeTruthy();
      });
    });
  });

  describe('GIVEN a follow-up assigned with key k-1', () => {
    const api = runningApi();
    let first: Reply;
    beforeEach(async () => {
      proposed(api.log);
      first = await actions(api.call, U.alice, ASSIGN, KEY);
    });

    describe('WHEN the identical request is replayed', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.alice, ASSIGN, KEY); });

      it('THEN 201 flagged idempotent_replay with the same follow-up id', () => {
        expect(r.status).toBe(201);
        expect(r.json.idempotent_replay).toBe(true);
        expect(r.json.data.followup.id).toBe(first.json.data.followup.id);
      });
    });
  });
});

describe('comments, participants, versions and diff', () => {
  describe('GIVEN a draft', () => {
    const api = runningApi();
    beforeEach(() => { draft(api.log); });

    describe('WHEN bob POSTs a comment mentioning @carol', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/decisions/PRJ-001/comments', { user: U.bob, body: { content: 'hello @carol' } }); });

      it('THEN 201 with carol as the mention', () => {
        expect(r.status).toBe(201);
        expect(r.json.comment.mentions).toEqual([U.carol]);
      });
    });
  });

  describe('GIVEN a draft with one comment by bob', () => {
    const api = runningApi();
    beforeEach(() => { api.log.addComment(draft(api.log).id, U.bob, { content: 'hello @carol' }); });

    describe('WHEN alice GETs the comments', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001/comments', { user: U.alice }); });

      it('THEN there is one', () => {
        expect(r.json.comments.length).toBe(1);
      });
    });

    describe('WHEN alice GETs participants', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001/participants', { user: U.alice }); });

      it('THEN they are alice and bob', () => {
        expect(r.json.participants.map((p: any) => p.user).sort()).toEqual([U.alice, U.bob]);
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    const api = runningApi();
    beforeEach(() => { proposed(api.log); });

    describe('WHEN the lead POSTs request_revision', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.lead, { action: 'request_revision', payload: { reason: 'timeline' } }); });

      it('THEN 201', () => {
        expect(r.status).toBe(201);
      });
    });
  });

  describe('GIVEN two proposals', () => {
    const api = runningApi();
    beforeEach(() => {
      const id = proposed(api.log);
      act(api.log, id, U.lead, 'request_revision', { reason: 'timeline' });
      api.log.updateDraft(id, U.alice, { content: CONTENT_V2 });
      act(api.log, id, U.alice, 'propose');
    });

    describe('WHEN bob GETs versions?limit=10', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001/versions?limit=10', { user: U.bob }); });

      it('THEN two versions return', () => {
        expect(r.json.versions.length).toBe(2);
      });
    });

    describe('WHEN bob GETs diff?from=v1&to=v2', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001/diff?from=v1&to=v2', { user: U.bob }); });

      it('THEN 200 with a change in the Decision section', () => {
        expect(r.status).toBe(200);
        expect(r.json.diff.changes.some((x: any) => x.section === 'Decision')).toBe(true);
      });
    });
  });
});

describe('todos, search, reports and listing', () => {
  describe('GIVEN PRJ-001 approved with a pending follow-up for carol, and PRJ-002 a draft', () => {
    const api = runningApi();
    beforeEach(() => {
      const id = proposed(api.log);
      for (const u of [U.bob, U.carol, U.david]) act(api.log, id, u, 'vote', { vote: 'approve' });
      act(api.log, id, U.alice, 'assign_followup', { title: 'once', assigned_to: U.carol, due_date: '2024-06-01' });
      api.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'two' });
    });
    const carolsTodoId = () => api.log.listTodos({ user: U.carol }).items[0].id;

    describe('WHEN carol GETs /todos?user=me&status=pending', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/todos?user=me&status=pending', { user: U.carol }); });

      it('THEN 200 with one item', () => {
        expect(r.status).toBe(200);
        expect(r.json.total).toBe(1);
      });
    });

    describe('WHEN bob PATCHes carol\'s todo', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('PATCH', `/todos/${carolsTodoId()}`, { user: U.bob, body: { status: 'completed' } }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });

    describe('WHEN carol PATCHes her todo to completed with notes', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('PATCH', `/todos/${carolsTodoId()}`, { user: U.carol, body: { status: 'completed', notes: 'done' } }); });

      it('THEN 200 and it is completed', () => {
        expect(r.status).toBe(200);
        expect(r.json.todo.status).toBe('completed');
      });
    });

    describe('WHEN alice searches q=PRJ-002', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/search?q=PRJ-002', { user: U.alice }); });

      it('THEN it is the first hit', () => {
        expect(r.json.items[0].decision_id).toBe('PRJ-002');
      });
    });

    describe('WHEN alice lists project=PRJ&status=approved&limit=5', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions?project=PRJ&status=approved&limit=5', { user: U.alice }); });

      it('THEN only PRJ-001 returns', () => {
        expect(r.json.items.map((d: any) => d.id)).toEqual(['PRJ-001']);
      });
    });

    describe('WHEN the org admin GETs /reports/decision_volume', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/reports/decision_volume', { user: U.org }); });

      it('THEN 200 with by_month', () => {
        expect(r.status).toBe(200);
        expect(r.json.report.by_month).toBeTruthy();
      });
    });

    describe('WHEN bob, a plain member, GETs /reports/audit', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/reports/audit', { user: U.bob }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });
  });
});

describe('admin endpoints create projects and members', () => {
  describe('GIVEN a running API', () => {
    const api = runningApi();

    describe('WHEN the org admin POSTs /teams/members adding zed', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/teams/members', { user: U.org, body: { owner: 'acme', team: 'default', user: 'zed@acme.com', role: 'member' } }); });

      it('THEN 201', () => {
        expect(r.status).toBe(201);
      });
    });

    describe('WHEN the org admin POSTs /projects creating OPS with veto mode', () => {
      let r: Reply;
      beforeEach(async () => {
        r = await api.call('POST', '/projects', { user: U.org, body: { owner: 'acme', identifier: 'OPS', title: 'Ops', settings: { approval_settings: { mode: 'veto' } } } });
      });

      it('THEN 201 and the mode is veto', () => {
        expect(r.status).toBe(201);
        expect(r.json.project.approval_settings.mode).toBe('veto');
      });
    });

    describe('WHEN bob, a plain member, POSTs /projects', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/projects', { user: U.bob, body: { owner: 'acme', identifier: 'X', title: 'x' } }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });
  });
});

describe('UI script only uses endpoints the API actually serves', () => {
  describe('GIVEN the top-level endpoints the served app.js calls', () => {
    const api = runningApi();
    let used: string[];
    beforeEach(async () => {
      const js = await (await fetch(`${api.base}/app.js`)).text();
      used = [...new Set([...js.matchAll(/api\(['"`](?:GET|POST|PATCH)?['"`]?,?\s*['"`](\/[a-z]+)/g)].map((m) => m[1]!))];
    });

    describe('WHEN each is requested', () => {
      let codes: Array<[string, unknown]>;
      beforeEach(async () => {
        codes = [];
        for (const path of used) codes.push([path, (await api.call('GET', path, { user: U.alice })).json?.error?.code]);
      });

      it('THEN none is an unrouted NOT_FOUND', () => {
        expect(used.length).toBeGreaterThan(0);
        for (const [path, code] of codes) expect(code, `${path} is not routed`).not.toBe('NOT_FOUND');
      });
    });
  });
});

describe('onMutation fires after successful writes only', () => {
  describe('GIVEN an onMutation hook that counts its calls', () => {
    const calls = { n: 0 };
    beforeEach(() => { calls.n = 0; });
    const api = runningApi(undefined, { onMutation: () => { calls.n++; } });

    describe('WHEN a GET succeeds', () => {
      let res: Response;
      beforeEach(async () => { res = await fetch(`${api.base}/decisions`, { headers: { 'x-user': U.alice } }); });

      it('THEN the hook does not fire', () => {
        expect(res.status).toBe(200);
        expect(calls.n).toBe(0);
      });
    });

    describe('WHEN a POST fails validation', () => {
      let status: number;
      beforeEach(async () => { ({ status } = await postDecision(api.base, { project: 'PRJ' })); });

      it('THEN 400 and the hook does not fire', () => {
        expect(status).toBe(400);
        expect(calls.n).toBe(0);
      });
    });

    describe('WHEN a valid POST succeeds', () => {
      let status: number;
      beforeEach(async () => { ({ status } = await postDecision(api.base, { project: 'PRJ', title: 'x' })); });

      it('THEN 201 and the hook fires once', () => {
        expect(status).toBe(201);
        expect(calls.n).toBe(1);
      });
    });
  });
});

describe('webhook management endpoints', () => {
  const HOOK = { owner: 'acme', url: 'https://hooks.example.com/x', events: ['decision.*'] };

  describe('GIVEN a running API', () => {
    const api = runningApi();

    describe('WHEN bob, a plain member, POSTs /webhooks', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/webhooks', { user: U.bob, body: HOOK }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });

    describe('WHEN the org admin POSTs a webhook targeting a loopback URL', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/webhooks', { user: U.org, body: { ...HOOK, url: 'http://127.0.0.1/x' } }); });

      it('THEN 400', () => {
        expect(r.status).toBe(400);
      });
    });

    describe('WHEN the org admin POSTs a valid webhook', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/webhooks', { user: U.org, body: HOOK }); });

      it('THEN 201 with a whsec_ secret', () => {
        expect(r.status).toBe(201);
        expect(r.json.webhook.secret).toMatch(/^whsec_/);
      });
    });
  });

  describe('GIVEN a webhook', () => {
    const api = runningApi();
    beforeEach(async () => { await api.call('POST', '/webhooks', { user: U.org, body: HOOK }); });

    describe('WHEN the org admin lists webhooks', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/webhooks?owner=acme', { user: U.org }); });

      it('THEN one is listed without its secret', () => {
        expect(r.json.webhooks.length).toBe(1);
        expect(r.json.webhooks[0]).not.toHaveProperty('secret');
      });
    });

    describe('WHEN a plain member lists webhooks', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/webhooks?owner=acme', { user: U.bob }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });
  });

  /** Call inside a describe(): a webhook (`hookId`) plus a decision created through the API after it. */
  function withDelivery() {
    const api = runningApi() as Api & { hookId: string };
    beforeEach(async () => {
      api.hookId = (await api.call('POST', '/webhooks', { user: U.org, body: HOOK })).json.webhook.id;
      await api.call('POST', '/decisions', { user: U.alice, body: { project: 'PRJ', title: 'fires a webhook' } });
    });
    return api;
  }

  describe('GIVEN a decision created after the webhook', () => {
    const api = withDelivery();

    describe('WHEN deliveries are listed', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', `/webhooks/${api.hookId}/deliveries`, { user: U.org }); });

      it('THEN the first is decision.created', () => {
        expect(r.json.items[0].event_type).toBe('decision.created');
      });
    });

    describe('WHEN the org admin DELETEs the webhook', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('DELETE', `/webhooks/${api.hookId}`, { user: U.org }); });

      it('THEN 200', () => {
        expect(r.status).toBe(200);
      });
    });
  });

  describe('GIVEN a delivery', () => {
    const api = withDelivery();
    let deliveryId: string;
    beforeEach(async () => { deliveryId = (await api.call('GET', `/webhooks/${api.hookId}/deliveries`, { user: U.org })).json.items[0].id; });

    describe('WHEN the org admin POSTs /deliveries/:id/redeliver', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', `/deliveries/${deliveryId}/redeliver`, { user: U.org }); });

      it('THEN 200', () => {
        expect(r.status).toBe(200);
      });
    });
  });

  describe('GIVEN a deleted webhook', () => {
    const api = withDelivery();
    beforeEach(async () => { await api.call('DELETE', `/webhooks/${api.hookId}`, { user: U.org }); });

    describe('WHEN webhooks are listed', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/webhooks?owner=acme', { user: U.org }); });

      it('THEN none remain', () => {
        expect(r.json.webhooks.length).toBe(0);
      });
    });
  });
});

describe('notification profile endpoints', () => {
  const PHONE = '+14155550123';
  const DAVID = encodeURIComponent(U.david);
  const SMS_PROFILE = { phone: PHONE, preferences: { channels: { sms: true }, muted_types: ['mention'] } };

  describe('GIVEN david without a stored profile', () => {
    const api = runningApi();

    describe('WHEN he GETs /profile', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/profile', { user: U.david }); });

      it('THEN 200 with his email and email enabled', () => {
        expect(r.status).toBe(200);
        expect(r.json.profile.email).toBe(U.david);
        expect(r.json.profile.preferences.channels.email).toBe(true);
      });
    });

    describe('WHEN he PUTs a phone and enables sms', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('PUT', '/profile', { user: U.david, body: SMS_PROFILE }); });

      it('THEN 200 with the merged profile', () => {
        expect(r.status).toBe(200);
        expect(r.json.profile.phone).toBe(PHONE);
        expect(r.json.profile.preferences.channels.sms).toBe(true);
      });
    });

    describe('WHEN he PUTs an invalid phone', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('PUT', '/profile', { user: U.david, body: { phone: 'nope' } }); });

      it('THEN 400', () => {
        expect(r.status).toBe(400);
      });
    });
  });

  describe('GIVEN david\'s stored profile with a phone', () => {
    const api = runningApi();
    beforeEach(async () => { await api.call('PUT', '/profile', { user: U.david, body: SMS_PROFILE }); });

    describe('WHEN carol GETs it by ?user=', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', `/profile?user=${DAVID}`, { user: U.carol }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });

    describe('WHEN the org admin GETs it by ?user=', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', `/profile?user=${DAVID}`, { user: U.org }); });

      it('THEN it returns his stored phone', () => {
        expect(r.json.profile.phone).toBe(PHONE);
      });
    });

    describe('WHEN bob PUTs to it by ?user=', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('PUT', `/profile?user=${DAVID}`, { user: U.bob, body: { phone: null } }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });
  });
});

describe('NUL characters are rejected at the boundary (they cannot be stored in PostgreSQL jsonb)', () => {
  describe('GIVEN a running API', () => {
    const api = runningApi();

    describe('WHEN a JSON body whose title contains \\u0000 is POSTed', () => {
      let r: Awaited<ReturnType<typeof postDecision>>;
      beforeEach(async () => { r = await postDecision(api.base, '{"project":"PRJ","title":"bad\\u0000title"}', { raw: true }); });

      it('THEN 400 INVALID_JSON', () => {
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe('INVALID_JSON');
      });
    });
  });
});

describe('a failing persistence hook turns into a 500 without leaking details', () => {
  describe('GIVEN an onMutation hook that throws', () => {
    const api = runningApi(undefined, { onMutation: async () => { throw new Error('connection to db-prod-7.internal:5432 refused'); } });

    describe('WHEN a decision is POSTed', () => {
      let r: Awaited<ReturnType<typeof postDecision>>;
      beforeEach(async () => { r = await postDecision(api.base, { project: 'PRJ', title: 'x' }); });

      it('THEN 500 INTERNAL_ERROR', () => {
        expect(r.status).toBe(500);
        expect(r.json.error.code).toBe('INTERNAL_ERROR');
      });

      it('THEN the response does not leak the internal host', () => {
        expect(r.text).not.toContain('db-prod-7');
      });
    });
  });
});

describe('an Idempotency-Key cannot be reused for a different request', () => {
  const KEY = { 'idempotency-key': 'k-1' };
  const assign = (title: string) => ({ action: 'assign_followup', payload: { title, assigned_to: U.carol } });

  describe('GIVEN a follow-up assigned with key k-1', () => {
    const api = runningApi();
    beforeEach(async () => {
      proposed(api.log);
      await actions(api.call, U.alice, assign('once'), KEY);
    });

    describe('WHEN k-1 is sent again with a different body', () => {
      let r: Reply;
      beforeEach(async () => { r = await actions(api.call, U.alice, assign('something else'), KEY); });

      it('THEN 409 CONFLICT and nothing new is assigned', () => {
        expect(r.status).toBe(409);
        expect(r.json.error.code).toBe('CONFLICT');
        expect(api.log.listTodos({ user: U.carol }).total).toBe(1);
      });
    });
  });
});

describe('owner, team and project endpoints', () => {
  describe('GIVEN a running API with owner acme and project PRJ', () => {
    const api = runningApi();

    describe('WHEN a new owner globex is POSTed', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/owners', { user: 'founder@globex.com', body: { identifier: 'globex', name: 'Globex' } }); });

      it('THEN 201 with the owner', () => {
        expect(r.status).toBe(201);
        expect(r.json.owner).toMatchObject({ identifier: 'globex', name: 'Globex' });
      });
    });

    describe('WHEN acme is POSTed again', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/owners', { user: U.org, body: { identifier: 'acme' } }); });

      it('THEN 409 CONFLICT', () => {
        expect(r.status).toBe(409);
        expect(r.json.error.code).toBe('CONFLICT');
      });
    });

    describe('WHEN the org admin POSTs team payments', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/teams', { user: U.org, body: { owner: 'acme', name: 'payments' } }); });

      it('THEN 201 with an empty team', () => {
        expect(r.status).toBe(201);
        expect(r.json.team).toMatchObject({ owner: 'acme', name: 'payments', members: [] });
      });
    });

    describe('WHEN bob, a plain member, POSTs a team', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('POST', '/teams', { user: U.bob, body: { owner: 'acme', name: 'payments' } }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });

    describe('WHEN bob GETs /projects/PRJ', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/projects/PRJ', { user: U.bob }); });

      it('THEN 200 with the project and its approval settings', () => {
        expect(r.status).toBe(200);
        expect(r.json.project.identifier).toBe('PRJ');
        expect(r.json.project.approval_settings.mode).toBe('consensus_voting');
      });
    });

    describe('WHEN bob GETs /projects/NOPE', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/projects/NOPE', { user: U.bob }); });

      it('THEN 404 NOT_FOUND', () => {
        expect(r.status).toBe(404);
        expect(r.json.error.code).toBe('NOT_FOUND');
      });
    });
  });
});

describe('decision document, related links and integrity endpoints', () => {
  describe('GIVEN an approved PRJ-001 and a draft PRJ-002 that mentions it', () => {
    const api = runningApi({ mode: 'consensus_voting', finder: () => [] });
    beforeEach(() => {
      const id = proposed(api.log);
      for (const u of [U.bob, U.carol, U.david]) act(api.log, id, u, 'vote', { vote: 'approve' });
      draft(api.log, { title: 'Follow-on', content: 'Builds on PRJ-001.' });
    });

    describe('WHEN bob GETs /decisions/PRJ-001/document', () => {
      let res: Response;
      let body: string;
      beforeEach(async () => {
        res = await fetch(`${api.base}/decisions/PRJ-001/document`, { headers: { 'x-user': U.bob } });
        body = await res.text();
      });

      it('THEN 200 markdown with the standard header', () => {
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
        expect(body).toMatch(/^# PRJ-001: Migrate to new database/);
        expect(body).toMatch(/- Status: Approved/);
      });
    });

    describe('WHEN an outsider GETs /decisions/PRJ-001/document', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001/document', { user: U.outsider }); });

      it('THEN 403 in the JSON error envelope', () => {
        expect(r.status).toBe(403);
        expect(r.json.error.code).toBe('FORBIDDEN');
      });
    });

    describe('WHEN bob GETs /decisions/PRJ-002/related', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-002/related', { user: U.bob }); });

      it('THEN 200 listing the mention-derived link to PRJ-001', () => {
        expect(r.status).toBe(200);
        expect(r.json.related.map((x: any) => x.related_decision_id)).toEqual(['PRJ-001']);
      });
    });

    describe('WHEN bob GETs /decisions/PRJ-001/integrity', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/decisions/PRJ-001/integrity', { user: U.bob }); });

      it('THEN 200 and the integrity check holds', () => {
        expect(r.status).toBe(200);
        expect(r.json.integrity.ok).toBe(true);
      });
    });
  });
});

describe('dashboard and notification endpoints', () => {
  describe('GIVEN alice\'s proposal is open', () => {
    const api = runningApi();
    beforeEach(() => { proposed(api.log); });

    describe('WHEN bob GETs /dashboard', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/dashboard', { user: U.bob }); });

      it('THEN 200 with alice\'s proposal awaiting his approval', () => {
        expect(r.status).toBe(200);
        expect(r.json.dashboard.awaiting_my_approval.map((d: any) => d.id)).toEqual(['PRJ-001']);
      });
    });

    describe('WHEN bob GETs /notifications', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/notifications', { user: U.bob }); });

      it('THEN 200 with his decision_proposed notification', () => {
        expect(r.status).toBe(200);
        expect(r.json.notifications.some((n: any) => n.type === 'decision_proposed' && n.decision_id === 'PRJ-001')).toBe(true);
      });
    });

    describe('WHEN alice GETs /notifications', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/notifications', { user: U.alice }); });

      it('THEN her own proposal is not among them', () => {
        expect(r.json.notifications.some((n: any) => n.type === 'decision_proposed')).toBe(false);
      });
    });
  });
});

describe('export endpoint', () => {
  describe('GIVEN two decisions', () => {
    const api = runningApi();
    beforeEach(() => { draft(api.log); draft(api.log, { title: 'Second' }); });

    describe('WHEN the org admin GETs /export?format=csv', () => {
      let res: Response;
      let body: string;
      beforeEach(async () => {
        res = await fetch(`${api.base}/export?format=csv`, { headers: { 'x-user': U.org } });
        body = await res.text();
      });

      it('THEN 200 text/csv with a header and two rows', () => {
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/csv/);
        expect(body.trim().split('\n')[0]!.split(',')[0]).toBe('id');
        expect(body.trim().split('\n').length).toBe(3);
      });
    });

    describe('WHEN the org admin GETs /export?format=json', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/export?format=json', { user: U.org }); });

      it('THEN 200 with both decisions', () => {
        expect(r.status).toBe(200);
        expect(r.json.decisions.map((d: any) => d.id).sort()).toEqual(['PRJ-001', 'PRJ-002']);
      });
    });

    describe('WHEN bob, a plain member, GETs /export', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/export?format=json', { user: U.bob }); });

      it('THEN 403', () => {
        expect(r.status).toBe(403);
      });
    });

    describe('WHEN the org admin GETs /export?format=xml', () => {
      let r: Reply;
      beforeEach(async () => { r = await api.call('GET', '/export?format=xml', { user: U.org }); });

      it('THEN 400 VALIDATION_ERROR', () => {
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });
});
