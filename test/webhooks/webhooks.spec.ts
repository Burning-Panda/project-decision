import { describe, it, expect, beforeEach } from 'bun:test';
import {
  WebhookDispatcher, verifySignature, SqliteStore, buildLog, freshLog, draft, proposed, act, attempt, expectCode,
  makeClock, testBox, tmpDbFile, onCleanup, U, URL_OK, PUBLIC_DNS, type LogHandle,
} from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN; when the
// THEN must also inspect state after the failure, the WHEN runs the action through attempt() instead.
// THEN may call read-only queries (listDeliveries, listWebhooks, ...) to observe the outcome.

type Recorder = ReturnType<typeof recorder>;
type Hooked = LogHandle & { hook: any };

function recorder(statuses: Array<number | Error> = [200]) {
  const calls: Array<{ url: string; init: any; body: any }> = [];
  let i = 0;
  const transport = async (url: string, init: any) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s instanceof Error) throw s;
    return { status: s };
  };
  return { calls, transport };
}

/** Call inside a describe(): a fresh log with one acme webhook (`hook`) to URL_OK for these events. */
function hookedLog(events: string[] = ['*'], settings?: Record<string, any>): Hooked {
  const h = freshLog(settings) as Hooked;
  beforeEach(() => { h.hook = h.log.createWebhook({ owner: 'acme', url: URL_OK, events, actor: U.org }); });
  return h;
}

/** Call inside a describe(): a decision.created hook with one pending delivery (PRJ-001 drafted). */
function pendingDelivery(): Hooked {
  const h = hookedLog(['decision.created']);
  beforeEach(() => { draft(h.log); });
  return h;
}

const dispatcherFor = (log: any, rec: Recorder, extra: Record<string, any> = {}) =>
  new WebhookDispatcher(log, { transport: rec.transport, resolve: PUBLIC_DNS, ...extra });

const firstDelivery = (h: Hooked) => h.log.listDeliveries(h.hook.id, U.org).items[0];

/** Event types emitted by running `fn`. */
function emittedBy(log: any, fn: () => unknown): string[] {
  const before = log.store.events.length;
  fn();
  return log.store.events.slice(before).map((e: any) => e.type);
}

// ---------------------------------------------------------------- registration
describe('org admins register webhooks; the secret is shown once and never listed', () => {
  describe('GIVEN an org admin', () => {
    const h = freshLog();

    describe('WHEN a webhook is created', () => {
      let hook: any;
      beforeEach(() => { hook = h.log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.*'], actor: U.org }); });

      it('THEN it returns a whsec_ secret, its events and active=true', () => {
        expect(hook.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
        expect(hook.events).toEqual(['decision.*']);
        expect(hook.active).toBe(true);
      });
    });

    describe('WHEN a webhook is created without events', () => {
      let hook: any;
      beforeEach(() => { hook = h.log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org }); });

      it('THEN it subscribes to all events', () => {
        expect(hook.events[0]).toBe('*');
      });
    });

    describe('WHEN the lead creates a webhook', () => {
      let create: () => unknown;
      beforeEach(() => { create = () => h.log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.lead }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(create, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN a plain member lists webhooks', () => {
      let list: () => unknown;
      beforeEach(() => { list = () => h.log.listWebhooks('acme', U.bob); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(list, 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN a created webhook', () => {
    const h = hookedLog(['decision.*']);

    describe('WHEN webhooks are listed', () => {
      let listed: any[];
      beforeEach(() => { listed = h.log.listWebhooks('acme', U.org); });

      it('THEN there is one and it has no secret', () => {
        expect(listed.length).toBe(1);
        expect(listed[0]).not.toHaveProperty('secret');
      });
    });
  });
});

describe('webhook URLs and event filters are validated', () => {
  const badUrls = [
    'ftp://hooks.example.com', 'not a url', 'https://user:pw@hooks.example.com/x', 'http://127.0.0.1/x',
    'http://localhost:3000/x', 'http://10.1.2.3/x', 'http://192.168.0.5/x', 'http://172.16.0.1/x', 'http://[::1]/x',
    'http://169.254.169.254/latest/meta-data', 'http://service.internal/x',
  ];
  for (const url of badUrls) {
    describe('GIVEN an org admin', () => {
      const h = freshLog();

      describe(`WHEN a webhook targets ${url}`, () => {
        let create: () => unknown;
        beforeEach(() => { create = () => h.log.createWebhook({ owner: 'acme', url, actor: U.org }); });

        it('THEN VALIDATION_ERROR 400', () => {
          expectCode(create, 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  const badEvents: Array<[string, unknown]> = [
    ['an unknown event', ['decision.exploded']],
    ['an unknown family wildcard', ['nope.*']],
    ['an empty list', []],
    ['a bare string instead of a list', 'decision.created'],
  ];
  for (const [label, events] of badEvents) {
    describe('GIVEN an org admin', () => {
      const h = freshLog();

      describe(`WHEN a webhook subscribes with ${label}`, () => {
        let create: () => unknown;
        beforeEach(() => { create = () => h.log.createWebhook({ owner: 'acme', url: URL_OK, events, actor: U.org }); });

        it('THEN VALIDATION_ERROR 400', () => {
          expectCode(create, 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN allowPrivateTargets is enabled', () => {
    const h = freshLog();
    beforeEach(() => { h.log.allowPrivateTargets = true; });

    describe('WHEN a localhost webhook is created', () => {
      let hook: any;
      beforeEach(() => { hook = h.log.createWebhook({ owner: 'acme', url: 'http://localhost:9000/hook', actor: U.org }); });

      it('THEN it is accepted', () => {
        expect(hook).toBeTruthy();
      });
    });
  });
});

describe('webhooks can be removed by admins only; removed hooks disappear from listings', () => {
  describe('GIVEN a webhook', () => {
    const h = hookedLog();

    describe('WHEN the lead deletes it', () => {
      let remove: () => unknown;
      beforeEach(() => { remove = () => h.log.deleteWebhook(h.hook.id, U.lead); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(remove, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the org admin deletes it', () => {
      beforeEach(() => { h.log.deleteWebhook(h.hook.id, U.org); });

      it('THEN listings no longer show it', () => {
        expect(h.log.listWebhooks('acme', U.org)).toEqual([]);
      });
    });

    describe('WHEN the org admin deletes webhook-999, which does not exist', () => {
      let remove: () => unknown;
      beforeEach(() => { remove = () => h.log.deleteWebhook('webhook-999', U.org); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(remove, 'NOT_FOUND', 404);
      });
    });
  });
});

// ---------------------------------------------------------------- events
describe('events are recorded in the outbox and fan out to matching active hooks of the same org only', () => {
  type FanOut = LogHandle & { all: any; approvedOnly: any; removed: any; foreign: any };

  /** acme hooks: all events, decision.approved only, and one deleted; plus an all-events hook of another org. */
  function hooks(): FanOut {
    const h = freshLog() as FanOut;
    beforeEach(() => {
      const { log } = h;
      h.all = log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org });
      h.approvedOnly = log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.approved'], actor: U.org });
      h.removed = log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org });
      log.deleteWebhook(h.removed.id, U.org);
      log.createOwner({ identifier: 'other' });
      h.foreign = log.createWebhook({ owner: 'other', url: URL_OK, actor: 'other' });
    });
    return h;
  }
  const types = (h: FanOut, hook: any, actor = U.org) => h.log.listDeliveries(hook.id, actor).items.map((d: any) => d.event_type).sort();

  describe('GIVEN acme hooks (all, approved-only, deleted) and another org\'s hook', () => {
    const h = hooks();

    describe('WHEN a decision is created and proposed', () => {
      beforeEach(() => { proposed(h.log); });

      it('THEN the outbox holds created then proposed', () => {
        expect(h.log.store.events.map((e: any) => e.type)).toEqual(['decision.created', 'decision.proposed']);
      });

      it('THEN the all-events hook gets both deliveries', () => {
        expect(types(h, h.all)).toEqual(['decision.created', 'decision.proposed']);
      });

      it('THEN the approved-only hook gets no deliveries', () => {
        expect(types(h, h.approvedOnly)).toEqual([]);
      });

      it('THEN the other org\'s hook gets no deliveries', () => {
        expect(types(h, h.foreign, 'other')).toEqual([]);
      });

      it('THEN the deleted hook gets no deliveries', () => {
        expect(h.log.store.deliveries.some((d: any) => d.webhook_id === h.removed.id)).toBe(false);
      });
    });
  });

  describe('GIVEN those hooks and a proposed decision', () => {
    const h = hooks();
    let id: string;
    beforeEach(() => { id = proposed(h.log); });

    describe('WHEN the lead approves', () => {
      beforeEach(() => { act(h.log, id, U.lead, 'approve'); });

      it('THEN the approved-only hook gets the decision.approved delivery', () => {
        expect(types(h, h.approvedOnly)).toEqual(['decision.approved']);
      });
    });
  });
});

describe('wildcard family filters match', () => {
  describe('GIVEN a decision.* hook and a proposed decision', () => {
    const h = hookedLog(['decision.*']);
    let id: string;
    beforeEach(() => { id = proposed(h.log); });

    describe('WHEN bob comments on it', () => {
      beforeEach(() => { h.log.addComment(id, U.bob, { content: 'hi' }); });

      it('THEN only the two decision events are delivered', () => {
        expect(h.log.listDeliveries(h.hook.id, U.org).total).toBe(2);
      });
    });
  });
});

describe('vote and approval events carry the documented payload', () => {
  describe('GIVEN a hook and a consensus decision closed by three approving votes with comments', () => {
    const h = hookedLog(['*'], { mode: 'consensus_voting' });
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      for (const u of [U.bob, U.carol, U.david]) act(h.log, id, u, 'vote', { vote: 'approve', comment: 'ok' });
    });

    describe('WHEN the outbox is read', () => {
      let events: any[];
      beforeEach(() => { events = h.log.store.events; });

      it('THEN bob\'s vote event carries event, decision_id, voter, vote, timestamp and id', () => {
        const vote = events.find((e) => e.type === 'decision.vote_received');
        expect(vote.payload.event).toBe('decision.vote_received');
        expect(vote.payload.decision_id).toBe(id);
        expect(vote.payload.voter).toBe(U.bob);
        expect(vote.payload.vote).toBe('approve');
        expect(vote.payload.timestamp).toMatch(/^2024-03-20T/);
        expect(vote.payload.id).toBe(vote.id);
      });

      it('THEN the last event is decision.approved listing the three approvers', () => {
        const approved = events.at(-1);
        expect(approved.type).toBe('decision.approved');
        expect([...approved.payload.approvers].sort()).toEqual([U.bob, U.carol, U.david]);
      });

      it('THEN all three vote events, including the closing one, precede the approval', () => {
        const types = events.map((e) => e.type);
        expect(types.filter((t) => t === 'decision.vote_received').length).toBe(3);
        expect(types.lastIndexOf('decision.vote_received')).toBeLessThan(types.indexOf('decision.approved'));
      });

      it('THEN no document or comment content leaks', () => {
        expect(JSON.stringify(events)).not.toContain('"content"');
      });
    });
  });
});

describe('every lifecycle step emits its event', () => {
  describe('GIVEN a hook', () => {
    const h = hookedLog();

    describe('WHEN a decision is drafted', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => draft(h.log)); });

      it('THEN decision.created is emitted', () => {
        expect(emitted).toContain('decision.created');
      });
    });
  });

  describe('GIVEN a draft', () => {
    const h = hookedLog();
    let id: string;
    beforeEach(() => { id = draft(h.log).id; });

    describe('WHEN it is proposed', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, id, U.alice, 'propose')); });

      it('THEN decision.proposed is emitted', () => {
        expect(emitted).toContain('decision.proposed');
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    const h = hookedLog();
    let id: string;
    beforeEach(() => { id = proposed(h.log); });

    describe('WHEN the lead requests a revision', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, id, U.lead, 'request_revision', { reason: 'more detail' })); });

      it('THEN decision.revision_requested is emitted', () => {
        expect(emitted).toContain('decision.revision_requested');
      });
    });

    describe('WHEN the lead declines', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, id, U.lead, 'decline', { reason: 'no' })); });

      it('THEN decision.declined is emitted', () => {
        expect(emitted).toContain('decision.declined');
      });
    });

    describe('WHEN the lead approves', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, id, U.lead, 'approve')); });

      it('THEN decision.approved is emitted', () => {
        expect(emitted).toContain('decision.approved');
      });
    });

    describe('WHEN bob records a meeting', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, id, U.bob, 'add_meeting', { transcript_text: 'we met' })); });

      it('THEN meeting.recorded is emitted', () => {
        expect(emitted).toContain('meeting.recorded');
      });
    });
  });

  describe('GIVEN a declined decision', () => {
    const h = hookedLog();
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      act(h.log, id, U.lead, 'decline', { reason: 'no' });
    });

    describe('WHEN the owner returns it to draft', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, id, U.alice, 'return_to_draft')); });

      it('THEN decision.returned_to_draft is emitted', () => {
        expect(emitted).toContain('decision.returned_to_draft');
      });
    });
  });

  describe('GIVEN an approved decision', () => {
    const h = hookedLog();
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      act(h.log, id, U.lead, 'approve');
    });

    describe('WHEN bob assigns a follow-up', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, id, U.bob, 'assign_followup', { title: 't', assigned_to: U.carol })); });

      it('THEN followup.assigned is emitted', () => {
        expect(emitted).toContain('followup.assigned');
      });
    });
  });

  describe('GIVEN a follow-up assigned to carol', () => {
    const h = hookedLog();
    let todoId: string;
    beforeEach(() => {
      act(h.log, proposed(h.log), U.bob, 'assign_followup', { title: 't', assigned_to: U.carol });
      todoId = h.log.listTodos({ user: U.carol }).items[0].id;
    });

    describe('WHEN carol completes it', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => h.log.updateTodo(todoId, U.carol, { status: 'completed' })); });

      it('THEN followup.completed is emitted', () => {
        expect(emitted).toContain('followup.completed');
      });
    });
  });

  describe('GIVEN a proposed superseding decision', () => {
    const h = hookedLog();
    let next: any;
    beforeEach(() => {
      const id = proposed(h.log);
      act(h.log, id, U.lead, 'approve');
      next = act(h.log, id, U.bob, 'create_superseding_decision', { title: 'v2' }).decision;
      act(h.log, next.id, U.bob, 'propose');
    });

    describe('WHEN the lead approves it', () => {
      let emitted: string[];
      beforeEach(() => { emitted = emittedBy(h.log, () => act(h.log, next.id, U.lead, 'approve')); });

      it('THEN decision.superseded is emitted', () => {
        expect(emitted).toContain('decision.superseded');
      });
    });
  });
});

describe('failed actions emit nothing', () => {
  describe('GIVEN a hook and a draft', () => {
    const h = hookedLog();
    let id: string;
    let eventsBefore: number;
    beforeEach(() => {
      id = draft(h.log).id;
      eventsBefore = h.log.store.events.length;
    });

    describe('WHEN bob fails to propose it', () => {
      let error: any;
      beforeEach(() => { error = attempt(() => act(h.log, id, U.bob, 'propose')); });

      it('THEN it is FORBIDDEN and no event is emitted', () => {
        expect(error?.code).toBe('FORBIDDEN');
        expect(h.log.store.events.length).toBe(eventsBefore);
      });
    });

    describe('WHEN the lead fails to approve it (wrong state)', () => {
      let error: any;
      beforeEach(() => { error = attempt(() => act(h.log, id, U.lead, 'approve')); });

      it('THEN it is INVALID_STATE and no event is emitted', () => {
        expect(error?.code).toBe('INVALID_STATE');
        expect(h.log.store.events.length).toBe(eventsBefore);
      });
    });
  });
});

// ---------------------------------------------------------------- delivery
describe('dispatcher POSTs signed JSON and marks deliveries delivered', () => {
  describe('GIVEN two pending deliveries (created, proposed) for a decision.* hook', () => {
    const h = hookedLog(['decision.*']);
    let rec: Recorder;
    beforeEach(() => {
      proposed(h.log);
      rec = recorder();
    });

    describe('WHEN the dispatcher runs', () => {
      let result: any;
      beforeEach(async () => { result = await dispatcherFor(h.log, rec).run(); });

      it('THEN both are attempted and delivered', () => {
        expect(result).toEqual({ attempted: 2, delivered: 2, failed: 0, retrying: 0 });
      });

      it('THEN the request is a manual-redirect JSON POST with event and delivery headers', () => {
        const first = rec.calls[0]!;
        expect(first.url).toBe(URL_OK);
        expect(first.init.method).toBe('POST');
        expect(first.init.headers['content-type']).toBe('application/json');
        expect(first.init.headers['x-decision-log-event']).toBe('decision.created');
        expect(first.init.headers['x-decision-log-delivery']).toMatch(/^dlv-\d+$/);
        expect(first.init.redirect).toBe('manual');
      });

      it('THEN the record is delivered after one attempt with status 200 and a timestamp', () => {
        const d = firstDelivery(h);
        expect(d.status).toBe('delivered');
        expect(d.attempts).toBe(1);
        expect(d.last_status).toBe(200);
        expect(d.delivered_at).toBeTruthy();
      });
    });
  });

  describe('GIVEN everything delivered', () => {
    const h = hookedLog(['decision.*']);
    let rec: Recorder;
    beforeEach(async () => {
      proposed(h.log);
      rec = recorder();
      await dispatcherFor(h.log, rec).run();
    });

    describe('WHEN the dispatcher runs again', () => {
      let result: any;
      beforeEach(async () => { result = await dispatcherFor(h.log, rec).run(); });

      it('THEN nothing is attempted', () => {
        expect(result).toEqual({ attempted: 0, delivered: 0, failed: 0, retrying: 0 });
      });
    });
  });
});

describe('failures retry with exponential backoff and give up after five attempts', () => {
  /** A pending delivery and a dispatcher whose receiver always answers 500. */
  function failingReceiver() {
    const h = pendingDelivery() as Hooked & { rec: Recorder; dispatcher: WebhookDispatcher };
    beforeEach(() => {
      h.rec = recorder([500]);
      h.dispatcher = dispatcherFor(h.log, h.rec);
    });
    return h;
  }

  describe('GIVEN a receiver answering 500', () => {
    const h = failingReceiver();

    describe('WHEN the dispatcher first runs', () => {
      let stats: any;
      beforeEach(async () => { stats = await h.dispatcher.run(); });

      it('THEN the delivery stays pending with a retry in one minute', () => {
        expect(stats.retrying).toBe(1);
        const d = firstDelivery(h);
        expect(d.status).toBe('pending');
        expect(d.attempts).toBe(1);
        expect(d.last_status).toBe(500);
        expect(d.next_attempt_at).toBe('2024-03-20T10:01:00.000Z');
      });
    });
  });

  describe('GIVEN a failure not yet due', () => {
    const h = failingReceiver();
    beforeEach(async () => { await h.dispatcher.run(); });

    describe('WHEN the dispatcher runs again immediately', () => {
      beforeEach(async () => { await h.dispatcher.run(); });

      it('THEN no further request is made', () => {
        expect(h.rec.calls.length).toBe(1);
      });
    });
  });

  describe('GIVEN a first failure two minutes ago', () => {
    const h = failingReceiver();
    beforeEach(async () => {
      await h.dispatcher.run();
      h.clock.advanceMinutes(2);
    });

    describe('WHEN the dispatcher runs', () => {
      beforeEach(async () => { await h.dispatcher.run(); });

      it('THEN the next retry is five minutes after the second failure', () => {
        expect(firstDelivery(h).next_attempt_at).toBe('2024-03-20T10:07:00.000Z');
      });
    });
  });

  describe('GIVEN two failed attempts', () => {
    const h = failingReceiver();
    beforeEach(async () => {
      await h.dispatcher.run();
      h.clock.advanceMinutes(2);
      await h.dispatcher.run();
    });

    describe('WHEN it runs five more times, 13 hours apart', () => {
      beforeEach(async () => {
        for (let i = 0; i < 5; i++) { h.clock.advanceHours(13); await h.dispatcher.run(); }
      });

      it('THEN it is failed with five attempts', () => {
        const d = firstDelivery(h);
        expect(d.status).toBe('failed');
        expect(d.attempts).toBe(5);
        expect(h.rec.calls.length).toBe(5);
      });
    });
  });
});

describe('transport errors are recorded and retried; recovery marks delivered', () => {
  /** A pending delivery and a dispatcher whose first request fails with ECONNREFUSED, then 204. */
  function flakyReceiver() {
    const h = pendingDelivery() as Hooked & { dispatcher: WebhookDispatcher };
    beforeEach(() => { h.dispatcher = dispatcherFor(h.log, recorder([new Error('ECONNREFUSED'), 204])); });
    return h;
  }

  describe('GIVEN a connection error on the first request', () => {
    const h = flakyReceiver();

    describe('WHEN the dispatcher runs', () => {
      beforeEach(async () => { await h.dispatcher.run(); });

      it('THEN no HTTP status is recorded and the error text is kept', () => {
        const d = firstDelivery(h);
        expect(d.last_status).toBe(null);
        expect(d.last_error).toMatch(/ECONNREFUSED/);
      });
    });
  });

  describe('GIVEN a connection error two minutes ago and a recovered receiver', () => {
    const h = flakyReceiver();
    beforeEach(async () => {
      await h.dispatcher.run();
      h.clock.advanceMinutes(2);
    });

    describe('WHEN the retry runs', () => {
      beforeEach(async () => { await h.dispatcher.run(); });

      it('THEN the delivery is delivered with the error cleared', () => {
        const d = firstDelivery(h);
        expect(d.status).toBe('delivered');
        expect(d.last_error).toBe(null);
      });
    });
  });
});

describe('redirects count as failures; they are never followed', () => {
  describe('GIVEN a pending delivery and a receiver answering 302', () => {
    const h = pendingDelivery();

    describe('WHEN the dispatcher runs', () => {
      beforeEach(async () => { await dispatcherFor(h.log, recorder([302])).run(); });

      it('THEN the delivery stays pending for retry', () => {
        expect(firstDelivery(h).status).toBe('pending');
      });
    });
  });
});

describe('failed deliveries can be redelivered by admins', () => {
  /** A delivery that failed five times; the receiver answers 200 from the sixth request on. */
  function exhausted() {
    const h = pendingDelivery() as Hooked & { dispatcher: WebhookDispatcher; id: string };
    beforeEach(async () => {
      h.dispatcher = dispatcherFor(h.log, recorder([500, 500, 500, 500, 500, 200]));
      for (let i = 0; i < 5; i++) { await h.dispatcher.run(); h.clock.advanceHours(13); }
      h.id = firstDelivery(h).id;
    });
    return h;
  }

  describe('GIVEN a delivery failed after five attempts', () => {
    const h = exhausted();

    describe('WHEN deliveries are filtered by status failed', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDeliveries(h.hook.id, U.org, { status: 'failed' }); });

      it('THEN one returns', () => {
        expect(page.total).toBe(1);
      });
    });

    describe('WHEN the lead redelivers it', () => {
      let redeliver: () => unknown;
      beforeEach(() => { redeliver = () => h.log.redeliver(h.id, U.lead); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(redeliver, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the org admin redelivers it', () => {
      let d: any;
      beforeEach(() => { d = h.log.redeliver(h.id, U.org); });

      it('THEN it is pending again', () => {
        expect(d.status).toBe('pending');
      });
    });

    describe('WHEN the org admin redelivers dlv-999, which does not exist', () => {
      let redeliver: () => unknown;
      beforeEach(() => { redeliver = () => h.log.redeliver('dlv-999', U.org); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(redeliver, 'NOT_FOUND', 404);
      });
    });
  });

  describe('GIVEN a redelivered delivery and a recovered receiver', () => {
    const h = exhausted();
    beforeEach(() => { h.log.redeliver(h.id, U.org); });

    describe('WHEN the dispatcher runs', () => {
      beforeEach(async () => { await h.dispatcher.run(); });

      it('THEN it is delivered', () => {
        expect(firstDelivery(h).status).toBe('delivered');
      });
    });
  });
});

describe('deliveries to removed hooks are cancelled, not sent', () => {
  describe('GIVEN a pending delivery whose hook was deleted', () => {
    const h = pendingDelivery();
    beforeEach(() => { h.log.deleteWebhook(h.hook.id, U.org); });

    describe('WHEN the dispatcher runs', () => {
      let rec: Recorder;
      beforeEach(async () => {
        rec = recorder();
        await dispatcherFor(h.log, rec).run();
      });

      it('THEN nothing is sent and it is cancelled', () => {
        expect(rec.calls.length).toBe(0);
        expect(h.log.store.deliveries[0].status).toBe('cancelled');
      });
    });
  });
});

describe('concurrent runs do not double-send', () => {
  describe('GIVEN a pending delivery and a slow receiver', () => {
    const h = pendingDelivery();
    let rec: Recorder;
    let dispatcher: WebhookDispatcher;
    beforeEach(() => {
      rec = recorder();
      const slow = async (...a: [string, any]) => { await new Promise((r) => setTimeout(r, 20)); return rec.transport(...a); };
      dispatcher = new WebhookDispatcher(h.log, { transport: slow, resolve: PUBLIC_DNS });
    });

    describe('WHEN two dispatcher runs overlap', () => {
      beforeEach(async () => { await Promise.all([dispatcher.run(), dispatcher.run()]); });

      it('THEN exactly one request is made', () => {
        expect(rec.calls.length).toBe(1);
      });
    });
  });
});

// ---------------------------------------------------------------- SSRF
describe('delivery refuses targets that resolve to private addresses', () => {
  const blocked: string[][] = [['10.0.0.5'], ['93.184.216.34', '127.0.0.1'], ['::1'], ['::ffff:192.168.1.1'], ['169.254.169.254']];

  for (const addrs of blocked) {
    describe('GIVEN a pending delivery', () => {
      const h = pendingDelivery();

      describe(`WHEN the hostname resolves to ${addrs.join(', ')} and the dispatcher runs`, () => {
        let rec: Recorder;
        beforeEach(async () => {
          rec = recorder();
          await new WebhookDispatcher(h.log, { transport: rec.transport, resolve: async () => addrs }).run();
        });

        it('THEN it fails as blocked_target without a request', () => {
          const d = firstDelivery(h);
          expect(d.status).toBe('failed');
          expect(d.last_error).toBe('blocked_target');
          expect(rec.calls.length).toBe(0);
        });
      });
    });
  }

  describe('GIVEN a pending delivery whose hostname resolves to 10.0.0.5', () => {
    const h = pendingDelivery();

    describe('WHEN a dispatcher configured with allowPrivateTargets runs', () => {
      let rec: Recorder;
      beforeEach(async () => {
        rec = recorder();
        await new WebhookDispatcher(h.log, { transport: rec.transport, resolve: async () => ['10.0.0.5'], allowPrivateTargets: true }).run();
      });

      it('THEN the request is made', () => {
        expect(rec.calls.length).toBe(1);
      });
    });
  });
});

// ---------------------------------------------------------------- signatures
describe('verifySignature accepts valid signatures and rejects tampering, wrong secrets and stale timestamps', () => {
  /** A delivered request; `base` holds the verifySignature arguments taken from it, at delivery time. */
  function signed() {
    const h = pendingDelivery() as Hooked & { body: string; base: Record<string, any> };
    beforeEach(async () => {
      const rec = recorder();
      await dispatcherFor(h.log, rec).run();
      const { init } = rec.calls[0]!;
      h.body = init.body;
      h.base = {
        secret: h.hook.secret, timestamp: init.headers['x-decision-log-timestamp'], body: init.body,
        signature: init.headers['x-decision-log-signature'], now: h.clock.now(),
      };
    });
    return h;
  }

  describe('GIVEN a genuine delivery', () => {
    const h = signed();
    const cases: Array<[string, () => Record<string, any>, boolean]> = [
      ['verified as received', () => ({}), true],
      ['verified with the body altered', () => ({ body: `${h.body} ` }), false],
      ['verified with the wrong secret', () => ({ secret: 'whsec_wrong' }), false],
      ['verified with a truncated sha256 signature', () => ({ signature: 'sha256=abc' }), false],
      ['verified with a garbage signature', () => ({ signature: 'garbage' }), false],
      ['verified with the signature missing', () => ({ signature: undefined }), false],
    ];

    for (const [label, change, valid] of cases) {
      describe(`WHEN ${label}`, () => {
        let result: boolean;
        beforeEach(() => { result = verifySignature({ ...h.base, ...change() } as any); });

        it(`THEN it is ${valid ? 'valid' : 'invalid'}`, () => {
          expect(result).toBe(valid);
        });
      });
    }
  });

  describe('GIVEN a delivery ten minutes old', () => {
    const h = signed();
    beforeEach(() => { h.clock.advanceMinutes(10); });

    describe('WHEN verified with the default tolerance', () => {
      let result: boolean;
      beforeEach(() => { result = verifySignature({ ...h.base, now: h.clock.now() } as any); });

      it('THEN it is rejected as older than the 5 minute tolerance', () => {
        expect(result).toBe(false);
      });
    });

    describe('WHEN verified with a 3600 second tolerance', () => {
      let result: boolean;
      beforeEach(() => { result = verifySignature({ ...h.base, now: h.clock.now(), toleranceSeconds: 3600 } as any); });

      it('THEN it is valid', () => {
        expect(result).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------- persistence
describe('webhooks, events and deliveries survive a SQLite round trip', () => {
  /** A webhook and one delivery committed to a SQLite file; `open()` reopens it as a new log (closed after the test). */
  function committed() {
    const ctx = {} as { hook: any; open: () => Promise<any> };
    beforeEach(async () => {
      const file = tmpDbFile('dl-wh-');
      const clock = makeClock();
      const box = testBox();
      const s1 = SqliteStore.open(file);
      const log = await buildLog({ store: s1, clock: clock.now, secretBox: box });
      log.createOwner({ identifier: 'acme' });
      log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
      log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
      ctx.hook = log.createWebhook({ owner: 'acme', url: URL_OK, actor: 'acme' });
      log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
      s1.commit();
      s1.close();
      ctx.open = async () => {
        const s2 = SqliteStore.open(file);
        onCleanup(() => s2.close());
        return buildLog({ store: s2, clock: clock.now, secretBox: box });
      };
    });
    return ctx;
  }

  describe('GIVEN a committed webhook and delivery', () => {
    const ctx = committed();

    describe('WHEN the database is reopened', () => {
      let again: any;
      beforeEach(async () => { again = await ctx.open(); });

      it('THEN the webhook is listed', () => {
        expect(again.listWebhooks('acme', 'acme').length).toBe(1);
      });

      it('THEN the delivery is listed', () => {
        expect(again.listDeliveries(ctx.hook.id, 'acme').total).toBe(1);
      });
    });
  });

  describe('GIVEN a reopened database', () => {
    const ctx = committed();
    let again: any;
    beforeEach(async () => { again = await ctx.open(); });

    describe('WHEN another decision is created', () => {
      beforeEach(() => { again.createDecision({ project: 'PRJ', actor: U.alice, title: 'y' }); });

      it('THEN event ids continue evt-001, evt-002', () => {
        expect(again.store.events.map((e: any) => e.id)).toEqual(['evt-001', 'evt-002']);
      });
    });
  });
});

// ---------------------------------------------------------------- end to end & housekeeping
describe('end to end over real HTTP: a local receiver verifies the signature', () => {
  describe('GIVEN a loopback receiver, private targets allowed and a pending delivery', () => {
    const h = freshLog() as Hooked;
    let received: Array<{ headers: Record<string, string>; body: string }>;
    beforeEach(() => {
      received = [];
      const receiver = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        async fetch(req) {
          received.push({ headers: Object.fromEntries(req.headers), body: await req.text() });
          return new Response(null, { status: 204 });
        },
      });
      onCleanup(() => receiver.stop(true));
      h.log.allowPrivateTargets = true;
      h.hook = h.log.createWebhook({ owner: 'acme', url: `http://127.0.0.1:${receiver.port}/hook`, events: ['decision.created'], actor: U.org });
      draft(h.log);
    });

    describe('WHEN the dispatcher runs with the real transport', () => {
      let stats: any;
      beforeEach(async () => { stats = await new WebhookDispatcher(h.log, { allowPrivateTargets: true }).run(); });

      it('THEN one delivery succeeds', () => {
        expect(stats.delivered).toBe(1);
        expect(received.length).toBe(1);
      });

      it('THEN the event header and body name decision.created for PRJ-001', () => {
        expect(received[0]!.headers['x-decision-log-event']).toBe('decision.created');
        expect(JSON.parse(received[0]!.body).decision_id).toBe('PRJ-001');
      });

      it('THEN the receiver can verify the signature', () => {
        const { headers, body } = received[0]!;
        expect(verifySignature({ secret: h.hook.secret, timestamp: headers['x-decision-log-timestamp'], body, signature: headers['x-decision-log-signature'], now: h.log.clock() })).toBe(true);
      });
    });
  });
});

describe('default policy refuses a loopback receiver at delivery time', () => {
  describe('GIVEN a pending delivery to a hook whose stored URL now points at loopback', () => {
    const h = hookedLog(['decision.created']);
    beforeEach(() => {
      h.log.store.webhooks[0].url = 'http://127.0.0.1:9/hook'; // bypass creation-time validation, as if DNS changed later
      draft(h.log);
    });

    describe('WHEN a dispatcher with the default policy runs', () => {
      let sentRequest: boolean;
      let stats: any;
      beforeEach(async () => {
        sentRequest = false;
        stats = await new WebhookDispatcher(h.log, { transport: () => { sentRequest = true; } }).run();
      });

      it('THEN it fails as blocked_target and never sends', () => {
        expect(sentRequest).toBe(false);
        expect(stats.failed).toBe(1);
        expect(firstDelivery(h).last_error).toBe('blocked_target');
      });
    });
  });
});

describe('pruneOutbox removes old finished deliveries and orphaned events, keeping pending ones', () => {
  /** A delivery delivered ten days ago and a recent one still pending. */
  function oldDeliveredAndRecentPending() {
    const h = pendingDelivery();
    beforeEach(async () => {
      await dispatcherFor(h.log, recorder()).run();
      h.clock.advanceDays(10);
      draft(h.log, { title: 'recent, still pending' });
    });
    return h;
  }

  describe('GIVEN a 10-day-old delivered row and a recent pending one', () => {
    const h = oldDeliveredAndRecentPending();

    describe('WHEN pruned at 7 days', () => {
      let removed: any;
      beforeEach(() => { removed = h.log.pruneOutbox({ olderThanDays: 7 }); });

      it('THEN one delivery and one event are removed', () => {
        expect(removed).toEqual({ deliveries: 1, events: 1 });
      });

      it('THEN only the pending delivery and its event remain', () => {
        expect(h.log.store.deliveries.length).toBe(1);
        expect(h.log.store.deliveries[0].status).toBe('pending');
        expect(h.log.store.events.length).toBe(1);
      });
    });
  });

  describe('GIVEN a pruned outbox whose pending delivery is now 30 days old', () => {
    const h = oldDeliveredAndRecentPending();
    beforeEach(() => {
      h.log.pruneOutbox({ olderThanDays: 7 });
      h.clock.advanceDays(30);
    });

    describe('WHEN pruned again', () => {
      let removed: any;
      beforeEach(() => { removed = h.log.pruneOutbox({ olderThanDays: 7 }); });

      it('THEN pending deliveries are never pruned', () => {
        expect(removed).toEqual({ deliveries: 0, events: 0 });
      });
    });
  });
});
