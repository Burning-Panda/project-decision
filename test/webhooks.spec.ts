import { describe, it, expect } from 'bun:test';
import {
  WebhookDispatcher, verifySignature, SqliteStore, buildLog, setup, draft, proposed, act, expectCode,
  makeClock, testBox, tmpDbFile, onCleanup, U, URL_OK, PUBLIC_DNS,
} from './support/index';

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

async function hooked(settings?: Record<string, any>, events: string[] = ['*']) {
  const ctx = await setup(settings);
  const hook = ctx.log.createWebhook({ owner: 'acme', url: URL_OK, events, actor: U.org });
  return { ...ctx, hook };
}

const dispatcherFor = (log: any, rec: ReturnType<typeof recorder>, extra: Record<string, any> = {}) =>
  new WebhookDispatcher(log, { transport: rec.transport, resolve: PUBLIC_DNS, ...extra });

/** Event types emitted by running `fn`. */
function emittedBy(log: any, fn: () => unknown): string[] {
  const before = log.store.events.length;
  fn();
  return log.store.events.slice(before).map((e: any) => e.type);
}

// ---------------------------------------------------------------- registration
describe('org admins register webhooks; the secret is shown once and never listed', () => {
  describe('GIVEN an org admin', () => {
    describe('WHEN a webhook is created', () => {
      it('THEN it returns a whsec_ secret, its events and active=true', async () => {
        const { log } = await setup();
        const hook = log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.*'], actor: U.org });
        expect(hook.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
        expect(hook.events).toEqual(['decision.*']);
        expect(hook.active).toBe(true);
      });
    });
  });

  describe('GIVEN a created webhook', () => {
    describe('WHEN webhooks are listed', () => {
      it('THEN there is one and it has no secret', async () => {
        const { log } = await setup();
        log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.*'], actor: U.org });
        const listed = log.listWebhooks('acme', U.org);
        expect(listed.length).toBe(1);
        expect('secret' in listed[0]).toBe(false);
      });
    });
  });

  describe('GIVEN an org admin', () => {
    describe('WHEN a webhook is created without events', () => {
      it('THEN it subscribes to all events', async () => {
        const { log } = await setup();
        expect(log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org }).events[0]).toBe('*');
      });
    });
  });

  describe('GIVEN the lead', () => {
    describe('WHEN creating a webhook', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.lead }), 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN a plain member', () => {
    describe('WHEN listing webhooks', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.listWebhooks('acme', U.bob), 'FORBIDDEN', 403);
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
    describe(`GIVEN an org admin`, () => {
      describe(`WHEN a webhook targets ${url}`, () => {
        it(`THEN VALIDATION_ERROR 400`, async () => {
          const { log } = await setup();
          expectCode(() => log.createWebhook({ owner: 'acme', url, actor: U.org }), 'VALIDATION_ERROR', 400);
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
    describe(`GIVEN an org admin`, () => {
      describe(`WHEN a webhook subscribes with ${label}`, () => {
        it(`THEN VALIDATION_ERROR 400`, async () => {
          const { log } = await setup();
          expectCode(() => log.createWebhook({ owner: 'acme', url: URL_OK, events, actor: U.org }), 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN allowPrivateTargets is enabled', () => {
    describe('WHEN a localhost webhook is created', () => {
      it('THEN it is accepted', async () => {
        const { log } = await setup();
        log.allowPrivateTargets = true;
        expect(log.createWebhook({ owner: 'acme', url: 'http://localhost:9000/hook', actor: U.org })).toBeTruthy();
      });
    });
  });
});

describe('webhooks can be removed by admins only; removed hooks disappear from listings', () => {
  describe('GIVEN a webhook', () => {
    describe('WHEN the lead deletes it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, hook } = await hooked();
        expectCode(() => log.deleteWebhook(hook.id, U.lead), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the org admin deletes it', () => {
      it('THEN listings no longer show it', async () => {
        const { log, hook } = await hooked();
        log.deleteWebhook(hook.id, U.org);
        expect(log.listWebhooks('acme', U.org)).toEqual([]);
      });
    });
  });

  describe('GIVEN no such webhook', () => {
    describe('WHEN the org admin deletes webhook-999', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log } = await hooked();
        expectCode(() => log.deleteWebhook('webhook-999', U.org), 'NOT_FOUND', 404);
      });
    });
  });
});

// ---------------------------------------------------------------- events
describe('events are recorded in the outbox and fan out to matching active hooks of the same org only', () => {
  async function fanOut() {
    const { log } = await setup();
    const all = log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org });
    const approvedOnly = log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.approved'], actor: U.org });
    const removed = log.createWebhook({ owner: 'acme', url: URL_OK, actor: U.org });
    log.deleteWebhook(removed.id, U.org);
    log.createOwner({ identifier: 'other' });
    const foreign = log.createWebhook({ owner: 'other', url: URL_OK, actor: 'other' });
    const id = proposed(log);
    const types = (hook: any, actor = U.org) => log.listDeliveries(hook.id, actor).items.map((d: any) => d.event_type).sort();
    return { log, id, all, approvedOnly, removed, foreign, types };
  }

  describe('GIVEN hooks', () => {
    describe('WHEN a decision is created and proposed', () => {
      it('THEN the outbox holds created then proposed', async () => {
        const { log } = await fanOut();
        expect(log.store.events.map((e: any) => e.type)).toEqual(['decision.created', 'decision.proposed']);
      });
    });
  });

  describe('GIVEN an all-events hook', () => {
    describe('WHEN a decision is created and proposed', () => {
      it('THEN it gets both deliveries', async () => {
        const { all, types } = await fanOut();
        expect(types(all)).toEqual(['decision.created', 'decision.proposed']);
      });
    });
  });

  describe('GIVEN an approved-only hook', () => {
    describe('WHEN a decision is only created and proposed', () => {
      it('THEN it gets no deliveries', async () => {
        const { approvedOnly, types } = await fanOut();
        expect(types(approvedOnly)).toEqual([]);
      });
    });
  });

  describe('GIVEN a hook owned by another org', () => {
    describe('WHEN acme events occur', () => {
      it('THEN it gets no deliveries', async () => {
        const { foreign, types } = await fanOut();
        expect(types(foreign, 'other')).toEqual([]);
      });
    });
  });

  describe('GIVEN a deleted hook', () => {
    describe('WHEN acme events occur', () => {
      it('THEN it gets no deliveries', async () => {
        const { log, removed } = await fanOut();
        expect(log.store.deliveries.some((d: any) => d.webhook_id === removed.id)).toBe(false);
      });
    });
  });

  describe('GIVEN an approved-only hook', () => {
    describe('WHEN the lead approves', () => {
      it('THEN it gets the decision.approved delivery', async () => {
        const { log, id, approvedOnly, types } = await fanOut();
        act(log, id, U.lead, 'approve');
        expect(types(approvedOnly)).toEqual(['decision.approved']);
      });
    });
  });
});

describe('wildcard family filters match', () => {
  describe('GIVEN a decision.* hook', () => {
    describe('WHEN a decision is created, proposed and commented on', () => {
      it('THEN only the two decision events are delivered', async () => {
        // Given
        const { log } = await setup();
        const decisionOnly = log.createWebhook({ owner: 'acme', url: URL_OK, events: ['decision.*'], actor: U.org });
        const id = proposed(log);
        // When
        log.addComment(id, U.bob, { content: 'hi' });
        // Then
        expect(log.listDeliveries(decisionOnly.id, U.org).total).toBe(2);
      });
    });
  });
});

describe('vote and approval events carry the documented payload', () => {
  async function approvedByVotes() {
    const { log } = await hooked({ mode: 'consensus_voting' });
    const id = proposed(log);
    for (const u of [U.bob, U.carol, U.david]) act(log, id, u, 'vote', { vote: 'approve', comment: 'ok' });
    return { log, id, events: log.store.events as any[] };
  }

  describe('GIVEN bob\'s approving vote', () => {
    describe('WHEN its event is read', () => {
      it('THEN it carries event, decision_id, voter, vote, timestamp and id', async () => {
        const { id, events } = await approvedByVotes();
        const vote = events.find((e) => e.type === 'decision.vote_received');
        expect(vote.payload.event).toBe('decision.vote_received');
        expect(vote.payload.decision_id).toBe(id);
        expect(vote.payload.voter).toBe(U.bob);
        expect(vote.payload.vote).toBe('approve');
        expect(vote.payload.timestamp).toMatch(/^2024-03-20T/);
        expect(vote.payload.id).toBe(vote.id);
      });
    });
  });

  describe('GIVEN three approving votes', () => {
    describe('WHEN the last event is read', () => {
      it('THEN it is decision.approved listing the three approvers', async () => {
        const { events } = await approvedByVotes();
        const approved = events.at(-1);
        expect(approved.type).toBe('decision.approved');
        expect([...approved.payload.approvers].sort()).toEqual([U.bob, U.carol, U.david]);
      });
    });
  });

  describe('GIVEN votes that closed the decision', () => {
    describe('WHEN the outbox order is read', () => {
      it('THEN all three vote events, including the closing one, precede the approval', async () => {
        const { events } = await approvedByVotes();
        const types = events.map((e) => e.type);
        expect(types.filter((t) => t === 'decision.vote_received').length).toBe(3);
        expect(types.lastIndexOf('decision.vote_received')).toBeLessThan(types.indexOf('decision.approved'));
      });
    });
  });

  describe('GIVEN votes with comments', () => {
    describe('WHEN the outbox is serialised', () => {
      it('THEN no document or comment content leaks', async () => {
        const { events } = await approvedByVotes();
        expect(JSON.stringify(events).includes('"content"')).toBe(false);
      });
    });
  });
});

describe('every lifecycle step emits its event', () => {
  const ctx = async () => hooked();

  describe('GIVEN a hook', () => {
    describe('WHEN a decision is drafted', () => {
      it('THEN decision.created is emitted', async () => {
        const { log } = await ctx();
        expect(emittedBy(log, () => draft(log))).toContain('decision.created');
      });
    });
  });

  describe('GIVEN a draft', () => {
    describe('WHEN it is proposed', () => {
      it('THEN decision.proposed is emitted', async () => {
        const { log } = await ctx();
        const d = draft(log);
        expect(emittedBy(log, () => act(log, d.id, U.alice, 'propose'))).toContain('decision.proposed');
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    describe('WHEN the lead requests a revision', () => {
      it('THEN decision.revision_requested is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        expect(emittedBy(log, () => act(log, id, U.lead, 'request_revision', { reason: 'more detail' }))).toContain('decision.revision_requested');
      });
    });
    describe('WHEN the lead declines', () => {
      it('THEN decision.declined is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        expect(emittedBy(log, () => act(log, id, U.lead, 'decline', { reason: 'no' }))).toContain('decision.declined');
      });
    });
  });

  describe('GIVEN a declined decision', () => {
    describe('WHEN the owner returns it to draft', () => {
      it('THEN decision.returned_to_draft is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        act(log, id, U.lead, 'decline', { reason: 'no' });
        expect(emittedBy(log, () => act(log, id, U.alice, 'return_to_draft'))).toContain('decision.returned_to_draft');
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    describe('WHEN the lead approves', () => {
      it('THEN decision.approved is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        expect(emittedBy(log, () => act(log, id, U.lead, 'approve'))).toContain('decision.approved');
      });
    });
  });

  describe('GIVEN an approved decision', () => {
    describe('WHEN bob assigns a follow-up', () => {
      it('THEN followup.assigned is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        act(log, id, U.lead, 'approve');
        expect(emittedBy(log, () => act(log, id, U.bob, 'assign_followup', { title: 't', assigned_to: U.carol }))).toContain('followup.assigned');
      });
    });
  });

  describe('GIVEN an assigned follow-up', () => {
    describe('WHEN carol completes it', () => {
      it('THEN followup.completed is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        act(log, id, U.bob, 'assign_followup', { title: 't', assigned_to: U.carol });
        const todo = log.listTodos({ user: U.carol }).items[0];
        expect(emittedBy(log, () => log.updateTodo(todo.id, U.carol, { status: 'completed' }))).toContain('followup.completed');
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    describe('WHEN bob records a meeting', () => {
      it('THEN meeting.recorded is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        expect(emittedBy(log, () => act(log, id, U.bob, 'add_meeting', { transcript_text: 'we met' }))).toContain('meeting.recorded');
      });
    });
  });

  describe('GIVEN a proposed superseding decision', () => {
    describe('WHEN the lead approves it', () => {
      it('THEN decision.superseded is emitted', async () => {
        const { log } = await ctx();
        const id = proposed(log);
        act(log, id, U.lead, 'approve');
        const next = act(log, id, U.bob, 'create_superseding_decision', { title: 'v2' }).decision;
        act(log, next.id, U.bob, 'propose');
        expect(emittedBy(log, () => act(log, next.id, U.lead, 'approve'))).toContain('decision.superseded');
      });
    });
  });
});

describe('failed actions emit nothing', () => {
  describe('GIVEN a draft', () => {
    describe('WHEN bob fails to propose it', () => {
      it('THEN no event is emitted', async () => {
        const { log } = await hooked();
        const d = draft(log);
        const before = log.store.events.length;
        expectCode(() => act(log, d.id, U.bob, 'propose'), 'FORBIDDEN');
        expect(log.store.events.length).toBe(before);
      });
    });
    describe('WHEN the lead fails to approve it (wrong state)', () => {
      it('THEN no event is emitted', async () => {
        const { log } = await hooked();
        const d = draft(log);
        const before = log.store.events.length;
        expectCode(() => act(log, d.id, U.lead, 'approve'), 'INVALID_STATE');
        expect(log.store.events.length).toBe(before);
      });
    });
  });
});

// ---------------------------------------------------------------- delivery
describe('dispatcher POSTs signed JSON and marks deliveries delivered', () => {
  async function ran() {
    const { log, clock, hook } = await hooked(undefined, ['decision.*']);
    proposed(log);
    const rec = recorder();
    const result = await dispatcherFor(log, rec).run();
    return { log, clock, hook, rec, result };
  }

  describe('GIVEN two pending deliveries', () => {
    describe('WHEN the dispatcher runs', () => {
      it('THEN both are attempted and delivered', async () => {
        const { result } = await ran();
        expect(result).toEqual({ attempted: 2, delivered: 2, failed: 0, retrying: 0 });
      });
    });
  });

  describe('GIVEN a delivery', () => {
    describe('WHEN the request is inspected', () => {
      it('THEN it is a manual-redirect JSON POST with event and delivery headers', async () => {
        const { rec } = await ran();
        const first = rec.calls[0];
        expect(first.url).toBe(URL_OK);
        expect(first.init.method).toBe('POST');
        expect(first.init.headers['content-type']).toBe('application/json');
        expect(first.init.headers['x-decision-log-event']).toBe('decision.created');
        expect(first.init.headers['x-decision-log-delivery']).toMatch(/^dlv-\d+$/);
        expect(first.init.redirect).toBe('manual');
      });
    });
    describe('WHEN its signature header is verified with the hook secret', () => {
      it('THEN it is valid', async () => {
        const { rec, hook, clock } = await ran();
        const { init } = rec.calls[0];
        const h = init.headers;
        expect(verifySignature({ secret: hook.secret, timestamp: h['x-decision-log-timestamp'], body: init.body, signature: h['x-decision-log-signature'], now: clock.now() })).toBe(true);
      });
    });
  });

  describe('GIVEN a successful delivery', () => {
    describe('WHEN its record is read', () => {
      it('THEN it is delivered after one attempt with status 200 and a timestamp', async () => {
        const { log, hook } = await ran();
        const d = log.listDeliveries(hook.id, U.org).items[0];
        expect(d.status).toBe('delivered');
        expect(d.attempts).toBe(1);
        expect(d.last_status).toBe(200);
        expect(d.delivered_at).toBeTruthy();
      });
    });
  });

  describe('GIVEN everything delivered', () => {
    describe('WHEN the dispatcher runs again', () => {
      it('THEN nothing is attempted', async () => {
        const { log, rec } = await ran();
        expect(await dispatcherFor(log, rec).run()).toEqual({ attempted: 0, delivered: 0, failed: 0, retrying: 0 });
      });
    });
  });
});

describe('failures retry with exponential backoff and give up after five attempts', () => {
  async function failing() {
    const { log, clock, hook } = await hooked(undefined, ['decision.created']);
    draft(log);
    const rec = recorder([500]);
    const dispatcher = dispatcherFor(log, rec);
    const state = () => log.listDeliveries(hook.id, U.org).items[0];
    return { clock, rec, dispatcher, state };
  }

  describe('GIVEN a receiver answering 500', () => {
    describe('WHEN the dispatcher first runs', () => {
      it('THEN the delivery stays pending with a retry in one minute', async () => {
        const { dispatcher, state } = await failing();
        expect((await dispatcher.run()).retrying).toBe(1);
        expect(state().status).toBe('pending');
        expect(state().attempts).toBe(1);
        expect(state().last_status).toBe(500);
        expect(state().next_attempt_at).toBe('2024-03-20T10:01:00.000Z');
      });
    });
  });

  describe('GIVEN a failure not yet due', () => {
    describe('WHEN the dispatcher runs again immediately', () => {
      it('THEN no request is made', async () => {
        const { dispatcher, rec } = await failing();
        await dispatcher.run();
        await dispatcher.run();
        expect(rec.calls.length).toBe(1);
      });
    });
  });

  describe('GIVEN a first failure', () => {
    describe('WHEN two minutes pass and it runs', () => {
      it('THEN the next retry is five minutes after the second failure', async () => {
        const { clock, dispatcher, state } = await failing();
        await dispatcher.run();
        clock.advanceMinutes(2);
        await dispatcher.run();
        expect(state().next_attempt_at).toBe('2024-03-20T10:07:00.000Z');
      });
    });
  });

  describe('GIVEN persistent failure', () => {
    describe('WHEN it runs after 13-hour gaps five more times', () => {
      it('THEN it is failed with five attempts', async () => {
        const { clock, dispatcher, rec, state } = await failing();
        await dispatcher.run();
        clock.advanceMinutes(2);
        await dispatcher.run();
        for (let i = 0; i < 5; i++) { clock.advanceHours(13); await dispatcher.run(); }
        expect(state().status).toBe('failed');
        expect(state().attempts).toBe(5);
        expect(rec.calls.length).toBe(5);
      });
    });
  });
});

describe('transport errors are recorded and retried; recovery marks delivered', () => {
  async function flaky() {
    const { log, clock, hook } = await hooked(undefined, ['decision.created']);
    draft(log);
    const dispatcher = dispatcherFor(log, recorder([new Error('ECONNREFUSED'), 204]));
    const read = () => log.listDeliveries(hook.id, U.org).items[0];
    return { clock, dispatcher, read };
  }

  describe('GIVEN a connection error', () => {
    describe('WHEN the dispatcher runs', () => {
      it('THEN no HTTP status is recorded and the error text is kept', async () => {
        const { dispatcher, read } = await flaky();
        await dispatcher.run();
        expect(read().last_status).toBe(null);
        expect(read().last_error).toMatch(/ECONNREFUSED/);
      });
    });
    describe('WHEN the receiver recovers and the retry runs', () => {
      it('THEN the delivery is delivered with the error cleared', async () => {
        const { clock, dispatcher, read } = await flaky();
        await dispatcher.run();
        clock.advanceMinutes(2);
        await dispatcher.run();
        expect(read().status).toBe('delivered');
        expect(read().last_error).toBe(null);
      });
    });
  });
});

describe('redirects count as failures; they are never followed', () => {
  describe('GIVEN a receiver answering 302', () => {
    describe('WHEN the dispatcher runs', () => {
      it('THEN the delivery stays pending for retry', async () => {
        const { log, hook } = await hooked(undefined, ['decision.created']);
        draft(log);
        await dispatcherFor(log, recorder([302])).run();
        expect(log.listDeliveries(hook.id, U.org).items[0].status).toBe('pending');
      });
    });
  });
});

describe('failed deliveries can be redelivered by admins', () => {
  async function exhausted() {
    const { log, clock, hook } = await hooked(undefined, ['decision.created']);
    draft(log);
    const rec = recorder([500, 500, 500, 500, 500, 200]);
    const dispatcher = dispatcherFor(log, rec);
    for (let i = 0; i < 5; i++) { await dispatcher.run(); clock.advanceHours(13); }
    const { id } = log.listDeliveries(hook.id, U.org).items[0];
    return { log, hook, dispatcher, id };
  }

  describe('GIVEN five failed attempts', () => {
    describe('WHEN deliveries are filtered by status failed', () => {
      it('THEN one returns', async () => {
        const { log, hook } = await exhausted();
        expect(log.listDeliveries(hook.id, U.org, { status: 'failed' }).total).toBe(1);
      });
    });
  });

  describe('GIVEN a failed delivery', () => {
    describe('WHEN the lead redelivers it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, id } = await exhausted();
        expectCode(() => log.redeliver(id, U.lead), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the org admin redelivers it', () => {
      it('THEN it is pending again', async () => {
        const { log, id } = await exhausted();
        expect(log.redeliver(id, U.org).status).toBe('pending');
      });
    });
  });

  describe('GIVEN a redelivered delivery', () => {
    describe('WHEN the dispatcher runs against a recovered receiver', () => {
      it('THEN it is delivered', async () => {
        const { log, hook, dispatcher, id } = await exhausted();
        log.redeliver(id, U.org);
        await dispatcher.run();
        expect(log.listDeliveries(hook.id, U.org).items[0].status).toBe('delivered');
      });
    });
  });

  describe('GIVEN no such delivery', () => {
    describe('WHEN dlv-999 is redelivered', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log } = await exhausted();
        expectCode(() => log.redeliver('dlv-999', U.org), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('deliveries to removed hooks are cancelled, not sent', () => {
  describe('GIVEN a pending delivery', () => {
    describe('WHEN its hook is deleted and the dispatcher runs', () => {
      it('THEN nothing is sent and it is cancelled', async () => {
        // Given
        const { log, hook } = await hooked(undefined, ['decision.created']);
        draft(log);
        log.deleteWebhook(hook.id, U.org);
        const rec = recorder();
        // When
        await dispatcherFor(log, rec).run();
        // Then
        expect(rec.calls.length).toBe(0);
        expect(log.store.deliveries[0].status).toBe('cancelled');
      });
    });
  });
});

describe('concurrent runs do not double-send', () => {
  describe('GIVEN a slow receiver', () => {
    describe('WHEN two dispatcher runs overlap', () => {
      it('THEN exactly one request is made', async () => {
        // Given
        const { log } = await hooked(undefined, ['decision.created']);
        draft(log);
        const rec = recorder();
        const slow = async (...a: [string, any]) => { await new Promise((r) => setTimeout(r, 20)); return rec.transport(...a); };
        const dispatcher = new WebhookDispatcher(log, { transport: slow, resolve: PUBLIC_DNS });
        // When
        await Promise.all([dispatcher.run(), dispatcher.run()]);
        // Then
        expect(rec.calls.length).toBe(1);
      });
    });
  });
});

// ---------------------------------------------------------------- SSRF
describe('delivery refuses targets that resolve to private addresses', () => {
  const blocked: string[][] = [['10.0.0.5'], ['93.184.216.34', '127.0.0.1'], ['::1'], ['::ffff:192.168.1.1'], ['169.254.169.254']];

  for (const addrs of blocked) {
    describe(`GIVEN a pending delivery`, () => {
      describe(`WHEN the hostname resolves to ${addrs.join(', ')}`, () => {
        it(`THEN it fails as blocked_target without a request`, async () => {
          // Given
          const { log, hook } = await hooked(undefined, ['decision.created']);
          draft(log);
          const rec = recorder();
          // When
          await new WebhookDispatcher(log, { transport: rec.transport, resolve: async () => addrs }).run();
          // Then
          const d = log.listDeliveries(hook.id, U.org).items[0];
          expect(d.status).toBe('failed');
          expect(d.last_error).toBe('blocked_target');
          expect(rec.calls.length).toBe(0);
        });
      });
    });
  }

  describe('GIVEN a private resolution', () => {
    describe('WHEN the dispatcher is configured with allowPrivateTargets', () => {
      it('THEN the request is made', async () => {
        const { log } = await hooked(undefined, ['decision.created']);
        draft(log);
        const rec = recorder();
        await new WebhookDispatcher(log, { transport: rec.transport, resolve: async () => ['10.0.0.5'], allowPrivateTargets: true }).run();
        expect(rec.calls.length).toBe(1);
      });
    });
  });
});

// ---------------------------------------------------------------- signatures
describe('verifySignature accepts valid signatures and rejects tampering, wrong secrets and stale timestamps', () => {
  async function signed() {
    const { log, clock, hook } = await hooked(undefined, ['decision.created']);
    draft(log);
    const rec = recorder();
    await dispatcherFor(log, rec).run();
    const { init } = rec.calls[0];
    const h = init.headers;
    const base = { secret: hook.secret, timestamp: h['x-decision-log-timestamp'], body: init.body, signature: h['x-decision-log-signature'], now: clock.now() };
    return { clock, init, base };
  }

  describe('GIVEN a genuine delivery', () => {
    describe('WHEN verified', () => {
      it('THEN it is valid', async () => {
        const { base } = await signed();
        expect(verifySignature(base)).toBe(true);
      });
    });
    describe('WHEN the body is altered', () => {
      it('THEN it is invalid', async () => {
        const { base, init } = await signed();
        expect(verifySignature({ ...base, body: `${init.body} ` })).toBe(false);
      });
    });
    describe('WHEN verified with the wrong secret', () => {
      it('THEN it is invalid', async () => {
        const { base } = await signed();
        expect(verifySignature({ ...base, secret: 'whsec_wrong' })).toBe(false);
      });
    });
    describe('WHEN the signature is a truncated sha256 value', () => {
      it('THEN it is invalid', async () => {
        const { base } = await signed();
        expect(verifySignature({ ...base, signature: 'sha256=abc' })).toBe(false);
      });
    });
    describe('WHEN the signature is garbage', () => {
      it('THEN it is invalid', async () => {
        const { base } = await signed();
        expect(verifySignature({ ...base, signature: 'garbage' })).toBe(false);
      });
    });
    describe('WHEN the signature is missing', () => {
      it('THEN it is invalid', async () => {
        const { base } = await signed();
        expect(verifySignature({ ...base, signature: undefined })).toBe(false);
      });
    });
    describe('WHEN verified ten minutes later', () => {
      it('THEN it is rejected as older than the 5 minute tolerance', async () => {
        const { base, clock } = await signed();
        clock.advanceMinutes(10);
        expect(verifySignature({ ...base, now: clock.now() })).toBe(false);
      });
    });
  });

  describe('GIVEN a delivery ten minutes old', () => {
    describe('WHEN verified with a 3600 second tolerance', () => {
      it('THEN it is valid', async () => {
        const { base, clock } = await signed();
        clock.advanceMinutes(10);
        expect(verifySignature({ ...base, now: clock.now(), toleranceSeconds: 3600 })).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------- persistence
describe('webhooks, events and deliveries survive a SQLite round trip', () => {
  async function reopened() {
    const file = tmpDbFile('dl-wh-');
    const clock = makeClock();
    const box = testBox();
    const s1 = SqliteStore.open(file);
    const log = await buildLog({ store: s1, clock: clock.now, secretBox: box });
    log.createOwner({ identifier: 'acme' });
    log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
    log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
    const hook = log.createWebhook({ owner: 'acme', url: URL_OK, actor: 'acme' });
    log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
    s1.commit();
    s1.close();
    const s2 = SqliteStore.open(file);
    const again = await buildLog({ store: s2, clock: clock.now, secretBox: box });
    return { s2, again, hook };
  }

  describe('GIVEN a committed webhook', () => {
    describe('WHEN the database is reopened', () => {
      it('THEN the webhook is listed', async () => {
        const { again, s2 } = await reopened();
        expect(again.listWebhooks('acme', 'acme').length).toBe(1);
        s2.close();
      });
    });
  });

  describe('GIVEN a committed delivery', () => {
    describe('WHEN the database is reopened', () => {
      it('THEN the delivery is listed', async () => {
        const { again, hook, s2 } = await reopened();
        expect(again.listDeliveries(hook.id, 'acme').total).toBe(1);
        s2.close();
      });
    });
  });

  describe('GIVEN a reopened database', () => {
    describe('WHEN another decision is created', () => {
      it('THEN event ids continue evt-001, evt-002', async () => {
        const { again, s2 } = await reopened();
        again.createDecision({ project: 'PRJ', actor: U.alice, title: 'y' });
        expect(again.store.events.map((e: any) => e.id)).toEqual(['evt-001', 'evt-002']);
        s2.close();
      });
    });
  });
});

// ---------------------------------------------------------------- end to end & housekeeping
describe('end to end over real HTTP: a local receiver verifies the signature', () => {
  async function delivered() {
    const received: Array<{ headers: Record<string, string>; body: string }> = [];
    const receiver = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(req) {
        received.push({ headers: Object.fromEntries(req.headers), body: await req.text() });
        return new Response(null, { status: 204 });
      },
    });
    onCleanup(() => receiver.stop(true));
    const { log } = await setup();
    log.allowPrivateTargets = true;
    const hook = log.createWebhook({ owner: 'acme', url: `http://127.0.0.1:${receiver.port}/hook`, events: ['decision.created'], actor: U.org });
    draft(log);
    const stats = await new WebhookDispatcher(log, { allowPrivateTargets: true }).run();
    return { log, hook, stats, received };
  }

  describe('GIVEN a loopback receiver and private targets allowed', () => {
    describe('WHEN the dispatcher runs', () => {
      it('THEN one delivery succeeds', async () => {
        const { stats, received } = await delivered();
        expect(stats.delivered).toBe(1);
        expect(received.length).toBe(1);
      });
    });
  });

  describe('GIVEN a received delivery', () => {
    describe('WHEN its event header and body are read', () => {
      it('THEN they name decision.created for PRJ-001', async () => {
        const { received } = await delivered();
        expect(received[0].headers['x-decision-log-event']).toBe('decision.created');
        expect(JSON.parse(received[0].body).decision_id).toBe('PRJ-001');
      });
    });
    describe('WHEN the receiver verifies the signature', () => {
      it('THEN it is valid', async () => {
        const { log, hook, received } = await delivered();
        const { headers, body } = received[0];
        expect(verifySignature({ secret: hook.secret, timestamp: headers['x-decision-log-timestamp'], body, signature: headers['x-decision-log-signature'], now: log.clock() })).toBe(true);
      });
    });
  });
});

describe('default policy refuses a loopback receiver at delivery time', () => {
  describe('GIVEN a hook whose stored URL now points at loopback', () => {
    describe('WHEN the dispatcher runs', () => {
      it('THEN it fails as blocked_target and never sends', async () => {
        // Given
        const { log, hook } = await hooked(undefined, ['decision.created']);
        log.store.webhooks[0].url = 'http://127.0.0.1:9/hook'; // bypass creation-time validation, as if DNS changed later
        draft(log);
        let sentRequest = false;
        // When
        const stats = await new WebhookDispatcher(log, { transport: () => { sentRequest = true; } }).run();
        // Then
        expect(sentRequest).toBe(false);
        expect(stats.failed).toBe(1);
        expect(log.listDeliveries(hook.id, U.org).items[0].last_error).toBe('blocked_target');
      });
    });
  });
});

describe('pruneOutbox removes old finished deliveries and orphaned events, keeping pending ones', () => {
  async function oldDeliveredAndRecentPending() {
    const { log, clock } = await hooked(undefined, ['decision.created']);
    draft(log);
    await dispatcherFor(log, recorder()).run();
    clock.advanceDays(10);
    draft(log, { title: 'recent, still pending' });
    return { log, clock };
  }

  describe('GIVEN a 10-day-old delivered row and a recent pending one', () => {
    describe('WHEN pruned at 7 days', () => {
      it('THEN one delivery and one event are removed', async () => {
        const { log } = await oldDeliveredAndRecentPending();
        expect(log.pruneOutbox({ olderThanDays: 7 })).toEqual({ deliveries: 1, events: 1 });
      });
    });
  });

  describe('GIVEN a prune at 7 days', () => {
    describe('WHEN the outbox is inspected', () => {
      it('THEN only the pending delivery and its event remain', async () => {
        const { log } = await oldDeliveredAndRecentPending();
        log.pruneOutbox({ olderThanDays: 7 });
        expect(log.store.deliveries.length).toBe(1);
        expect(log.store.deliveries[0].status).toBe('pending');
        expect(log.store.events.length).toBe(1);
      });
    });
  });

  describe('GIVEN a pending delivery 30 days old', () => {
    describe('WHEN pruned again', () => {
      it('THEN pending deliveries are never pruned', async () => {
        const { log, clock } = await oldDeliveredAndRecentPending();
        log.pruneOutbox({ olderThanDays: 7 });
        clock.advanceDays(30);
        expect(log.pruneOutbox({ olderThanDays: 7 })).toEqual({ deliveries: 0, events: 0 });
      });
    });
  });
});
