import { describe, it, expect, beforeEach } from 'bun:test';
import {
  NotificationChannel, NotificationManager, createNotificationPayload, validateNotificationPayload,
  sent, failed, skipped, isDeliveryResult, checkChannelConformance,
  type ChannelName, type DeliveryResult, type NotificationPayload, type NotificationPayloadInput, type NotificationPriority,
  SqliteStore, buildLog, setup, proposed, act, expectCode, makeClock, testBox, tmpDbFile, U,
} from './support/index';

// ---------------------------------------------------------------- test doubles
type Script = (DeliveryResult | Error)[];
type Address = 'email' | 'phone' | 'push_tokens';

class FakeChannel extends NotificationChannel {
  channelName: ChannelName;
  needs: Address;
  script: Script;
  calls: NotificationPayload[] = [];
  constructor(channelName: ChannelName, { needs = 'email', script = [] }: { needs?: Address; script?: Script } = {}) {
    super();
    this.channelName = channelName;
    this.needs = needs;
    this.script = script; // results (or Errors) returned by successive send() calls; last one repeats
  }
  get name() { return this.channelName; }
  supports(payload: NotificationPayload) { return Boolean(this.needs === 'push_tokens' ? payload.recipient.push_tokens.length : payload.recipient[this.needs]); }
  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    this.calls.push(payload);
    const next = this.script[Math.min(this.calls.length - 1, this.script.length - 1)] ?? sent(`${this.name}-${this.calls.length}`);
    if (next instanceof Error) throw next;
    return next;
  }
}
const email = (script?: Script) => new FakeChannel('email', { needs: 'email', script });
const sms = (script?: Script) => new FakeChannel('sms', { needs: 'phone', script });
const push = (script?: Script) => new FakeChannel('push', { needs: 'push_tokens', script });

const INPUT: NotificationPayloadInput = {
  id: 'notif-001', type: 'decision_proposed',
  recipient: { user: U.bob, email: U.bob },
  content: { title: 'Decision proposed', body: 'PRJ-001 needs your review' },
};

async function managed(channels: NotificationChannel[], { settings, appUrl = 'https://dl.example.com' }: { settings?: Record<string, any>; appUrl?: string } = {}) {
  const ctx = await setup(settings);
  const manager = new NotificationManager(ctx.log, { appUrl });
  for (const c of channels) manager.register(c);
  return { ...ctx, manager };
}

/** One proposed decision whose single notification (to bob) is kept, so delivery rows are predictable. */
async function singleNotification(channel: NotificationChannel) {
  const ctx = await managed([channel]);
  ctx.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
  act(ctx.log, 'PRJ-001', U.alice, 'propose');
  ctx.log.store.notifications.splice(1);
  const only = ctx.log.store.notifications[0];
  const row = () => ctx.log.store.channel_deliveries.find((d: any) => d.notification_id === only.id);
  return { ...ctx, row };
}

// ---------------------------------------------------------------- payload
describe('createNotificationPayload fills defaults and freezes the result', () => {
  describe('GIVEN a minimal input', () => {
    describe('WHEN the payload is created', () => {
      it('THEN version, priority and null/empty defaults are filled in', () => {
        const p = createNotificationPayload(INPUT);
        expect(p.version).toBe(1);
        expect(p.priority).toBe('normal');
        expect(p.recipient).toEqual({ user: U.bob, email: U.bob, phone: null, push_tokens: [] });
        expect(p.content).toEqual({ title: 'Decision proposed', body: 'PRJ-001 needs your review', html: null, link: null });
        expect(p.context).toEqual({ decision_id: null, project: null, actor: null });
        expect(p.data).toEqual({});
      });

      it('THEN dedupe_key defaults to the id and created_at is an ISO timestamp', () => {
        const p = createNotificationPayload(INPUT);
        expect(p.dedupe_key).toBe('notif-001');
        expect(p.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    });
  });

  describe('GIVEN a created payload', () => {
    describe('WHEN its objects are checked', () => {
      it('THEN the payload and recipient are frozen', () => {
        const p = createNotificationPayload(INPUT);
        expect(Object.isFrozen(p)).toBe(true);
        expect(Object.isFrozen(p.recipient)).toBe(true);
      });
    });
  });

  describe('GIVEN a frozen payload', () => {
    describe('WHEN a nested field is assigned in strict mode', () => {
      it('THEN it throws a TypeError', () => {
        const p = createNotificationPayload(INPUT);
        expect(() => { 'use strict'; (p.content as { title: string }).title = 'x'; }).toThrow(TypeError);
      });
    });
  });
});

describe('payload validation reports every problem', () => {
  describe('GIVEN a payload broken in every field', () => {
    describe('WHEN validated', () => {
      it('THEN an error is reported for each field', () => {
        const errors = validateNotificationPayload({
          type: '', priority: 'urgent',
          recipient: { user: '', email: 'nope', phone: '12', push_tokens: 'abc' },
          content: { title: '', body: 'x'.repeat(10_001), link: 'javascript:alert(1)' },
          data: { f() {} },
        });
        for (const frag of ['type', 'priority', 'recipient.user', 'recipient.email', 'recipient.phone', 'recipient.push_tokens', 'content.title', 'content.body', 'content.link', 'data']) {
          expect(errors.some((e: string) => e.startsWith(frag)), `expected an error for ${frag}: ${errors.join(' | ')}`).toBe(true);
        }
      });
    });
  });

  describe('GIVEN an invalid priority', () => {
    describe('WHEN a payload is created', () => {
      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(() => createNotificationPayload({ ...INPUT, priority: 'urgent' as NotificationPriority }), 'VALIDATION_ERROR', 400);
      });
    });
  });

  describe('GIVEN a valid payload', () => {
    describe('WHEN validated', () => {
      it('THEN there are no errors', () => {
        expect(validateNotificationPayload(createNotificationPayload(INPUT))).toEqual([]);
      });
    });
  });

  describe('GIVEN circular data', () => {
    describe('WHEN validated', () => {
      it('THEN a data error is reported', () => {
        const circular: any = {}; circular.self = circular;
        expect(validateNotificationPayload({ ...INPUT, data: circular }).some((e: string) => e.startsWith('data'))).toBe(true);
      });
    });
  });

  describe('GIVEN an email address with an injected header', () => {
    describe('WHEN validated', () => {
      it('THEN a recipient.email error is reported', () => {
        const errors = validateNotificationPayload({ ...INPUT, recipient: { user: 'a', email: 'a@b.co\r\nBcc: x@y.z' } });
        expect(errors.some((e: string) => e.startsWith('recipient.email'))).toBe(true);
      });
    });
  });
});

describe('delivery result helpers', () => {
  describe('GIVEN the helpers', () => {
    describe('WHEN sent, failed and skipped are called', () => {
      it('THEN they build the documented result shapes', () => {
        expect(sent('abc')).toEqual({ status: 'sent', provider_id: 'abc' });
        expect(failed('boom')).toEqual({ status: 'failed', error: 'boom', retryable: true });
        expect(failed('bad address', { retryable: false })).toEqual({ status: 'failed', error: 'bad address', retryable: false });
        expect(skipped('no_address')).toEqual({ status: 'skipped', reason: 'no_address' });
      });
    });
  });

  describe('GIVEN built results', () => {
    describe('WHEN isDeliveryResult is asked', () => {
      it('THEN they are valid', () => {
        for (const r of [sent('x'), failed('x'), skipped('x')]) expect(isDeliveryResult(r)).toBe(true);
      });
    });
  });

  describe('GIVEN malformed values', () => {
    describe('WHEN isDeliveryResult is asked', () => {
      it('THEN none are valid', () => {
        for (const r of [null, {}, { status: 'ok' }, { status: 'failed' }, { status: 'failed', error: 'x' }, 'sent']) expect(isDeliveryResult(r)).toBe(false);
      });
    });
  });
});

// ---------------------------------------------------------------- channel contract
describe('NotificationChannel is abstract', () => {
  describe('GIVEN a bare channel', () => {
    describe('WHEN name is read', () => {
      it('THEN it demands an implementation', () => {
        expect(() => new NotificationChannel().name).toThrow(/implement/i);
      });
    });
    describe('WHEN supports is called', () => {
      it('THEN it demands an implementation', () => {
        expect(() => new NotificationChannel().supports({} as NotificationPayload)).toThrow(/implement/i);
      });
    });
    describe('WHEN send is called', () => {
      it('THEN it rejects demanding an implementation', async () => {
        await expect(new NotificationChannel().send({} as NotificationPayload)).rejects.toThrow(/implement/i);
      });
    });
  });
});

describe('the conformance kit accepts a well-behaved channel and flags broken ones', () => {
  class Broken extends NotificationChannel {
    get name() { return 'Bad Name'; }
    supports() { return 'yes' as any; }
    async send(payload: any) { try { payload.data.x = 1; } catch { /* frozen */ } return { status: 'delivered' } as any; }
  }

  describe('GIVEN a well-behaved channel', () => {
    describe('WHEN checked', () => {
      it('THEN no problems are reported', async () => {
        const problems = await checkChannelConformance(email(), {
          payload: createNotificationPayload(INPUT),
          unaddressable: createNotificationPayload({ ...INPUT, recipient: { user: 'x' } }),
        });
        expect(problems).toEqual([]);
      });
    });
  });

  describe('GIVEN a broken channel', () => {
    describe('WHEN checked', () => {
      it('THEN name, supports and delivery-result problems are all flagged', async () => {
        const problems = await checkChannelConformance(new Broken(), { payload: createNotificationPayload(INPUT) });
        expect(problems.some((p: string) => /name/.test(p))).toBe(true);
        expect(problems.some((p: string) => /supports/.test(p))).toBe(true);
        expect(problems.some((p: string) => /delivery result/i.test(p))).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------- manager registration
describe('the manager validates and registers channels', () => {
  const capture = (fn: () => unknown): unknown => {
    try { fn(); } catch (error) { return error; }
    return undefined;
  };

  describe('GIVEN a manager', () => {
    let manager: NotificationManager;
    beforeEach(async () => {
      manager = new NotificationManager((await setup()).log);
    });

    describe('WHEN an email channel is registered', () => {
      beforeEach(() => { manager.register(email()); });

      it('THEN its name is listed', () => {
        expect(manager.channelNames).toEqual(['email']);
      });
    });

    describe('WHEN a plain object is registered', () => {
      let error: unknown;
      beforeEach(() => { error = capture(() => manager.register({ name: 'x', send() {} } as unknown as NotificationChannel)); });

      it('THEN it must be a NotificationChannel', () => {
        expect(String(error)).toMatch(/NotificationChannel/);
      });
    });

    describe('WHEN a channel with an invalid name is registered', () => {
      let error: unknown;
      beforeEach(() => { error = capture(() => manager.register(new FakeChannel('Not Valid!'))); });

      it('THEN the name is rejected', () => {
        expect(String(error)).toMatch(/name/);
      });
    });
  });

  describe('GIVEN a manager with an email channel registered', () => {
    let manager: NotificationManager;
    beforeEach(async () => {
      manager = new NotificationManager((await setup()).log);
      manager.register(email());
    });

    describe('WHEN another email channel is registered', () => {
      let error: unknown;
      beforeEach(() => { error = capture(() => manager.register(email())); });

      it('THEN it is rejected as already registered', () => {
        expect(String(error)).toMatch(/already registered/i);
      });
    });
  });
});

// ---------------------------------------------------------------- profiles & preferences
describe('profiles default sensibly: email derives from the user id, email is the only channel on', () => {
  describe('GIVEN bob without a stored profile', () => {
    describe('WHEN he reads it', () => {
      it('THEN email derives from his id and email is the only enabled channel', async () => {
        const { log } = await setup();
        const p = log.getProfile(U.bob, U.bob);
        expect(p.email).toBe(U.bob);
        expect(p.phone).toBe(null);
        expect(p.push_tokens).toEqual([]);
        expect(p.preferences).toEqual({ channels: { email: true, sms: false, push: false }, order: ['email', 'sms', 'push'], mode: 'all', muted_types: [] });
      });
    });
  });

  describe('GIVEN a member whose id is not an address', () => {
    describe('WHEN the org reads the profile', () => {
      it('THEN email is null', async () => {
        const { log } = await setup();
        log.addTeamMember({ owner: 'acme', user: 'acme-bot', actor: 'acme' });
        expect(log.getProfile('acme-bot', 'acme').email).toBe(null);
      });
    });
  });
});

describe('profile updates merge, validate and respect permissions', () => {
  describe('GIVEN bob', () => {
    describe('WHEN he sets a phone, enables sms and mutes vote_received', () => {
      it('THEN the profile reflects it', async () => {
        const { log } = await setup();
        const p = log.setProfile(U.bob, U.bob, { phone: '+14155550123', preferences: { channels: { sms: true }, muted_types: ['vote_received'] } });
        expect(p.phone).toBe('+14155550123');
        expect(p.preferences.channels).toEqual({ email: true, sms: true, push: false });
      });
    });
  });

  describe('GIVEN a stored phone', () => {
    describe('WHEN bob later sets push tokens and fallback order', () => {
      it('THEN earlier fields are kept and new ones merged', async () => {
        const { log } = await setup();
        log.setProfile(U.bob, U.bob, { phone: '+14155550123', preferences: { channels: { sms: true }, muted_types: ['vote_received'] } });
        const again = log.setProfile(U.bob, U.bob, { push_tokens: ['tok-1'], preferences: { mode: 'fallback', order: ['push', 'email'] } });
        expect(again.phone).toBe('+14155550123');
        expect(again.preferences.muted_types).toEqual(['vote_received']);
        expect(again.preferences.mode).toBe('fallback');
        expect(again.preferences.order).toEqual(['push', 'email']);
      });
    });
  });

  const invalid: Array<[string, Record<string, unknown>]> = [
    ['a malformed email', { email: 'not-an-email' }],
    ['an email with an injected header', { email: 'a@b.co\r\nBcc: evil@x.io' }],
    ['a non-E.164 phone', { phone: '555-1234' }],
    ['push_tokens that is not a list', { push_tokens: 'abc' }],
    ['more than ten push tokens', { push_tokens: Array(11).fill('t') }],
    ['an unknown channel', { preferences: { channels: { fax: true } } }],
    ['a non-boolean channel flag', { preferences: { channels: { sms: 'yes' } } }],
    ['an unknown mode', { preferences: { mode: 'sometimes' } }],
    ['a duplicate channel order', { preferences: { order: ['email', 'email'] } }],
    ['muted_types that is not a list', { preferences: { muted_types: 'all' } }],
  ];
  for (const [label, input] of invalid) {
    describe(`GIVEN bob`, () => {
      describe(`WHEN he saves a profile with ${label}`, () => {
        it(`THEN VALIDATION_ERROR 400`, async () => {
          const { log } = await setup();
          expectCode(() => log.setProfile(U.bob, U.bob, input), 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN bob\'s profile', () => {
    describe('WHEN carol reads it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.getProfile(U.bob, U.carol), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN carol edits it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.setProfile(U.bob, U.carol, { phone: '+14155550123' }), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the org admin edits his email', () => {
      it('THEN the change is applied', async () => {
        const { log } = await setup();
        expect(log.setProfile(U.bob, U.org, { email: 'bob@personal.example' }).email).toBe('bob@personal.example');
      });
    });
  });

  describe('GIVEN a stored phone', () => {
    describe('WHEN bob sets phone to null', () => {
      it('THEN it is cleared', async () => {
        const { log } = await setup();
        log.setProfile(U.bob, U.bob, { phone: '+14155550123' });
        expect(log.setProfile(U.bob, U.bob, { phone: null }).phone).toBe(null);
      });
    });
  });
});

// ---------------------------------------------------------------- manager runs
describe('in-app notifications are turned into standard payloads and sent once', () => {
  async function ran() {
    const mail = email();
    const ctx = await managed([mail]);
    const id = proposed(ctx.log); // notifies bob, carol, david and the lead
    const stats = await ctx.manager.run();
    return { ...ctx, mail, id, stats };
  }

  describe('GIVEN four in-app notifications', () => {
    describe('WHEN the manager runs', () => {
      it('THEN every one is planned and sent', async () => {
        const { log, mail, stats } = await ran();
        expect(stats.planned).toBe(log.store.notifications.length);
        expect(stats.sent).toBe(mail.calls.length);
      });
    });
  });

  describe('GIVEN a proposal', () => {
    describe('WHEN the manager runs', () => {
      it('THEN bob\'s email payload has the standard title, body, link, recipient, context and priority', async () => {
        const { mail, id } = await ran();
        const toBob = mail.calls.find((p) => p.recipient.user === U.bob)!;
        expect(toBob.type).toBe('decision_proposed');
        expect(toBob.content.title).toBe(`[${id}] Decision proposed for review`);
        expect(toBob.content.body).toMatch(/was proposed/);
        expect(toBob.content.link).toBe(`https://dl.example.com/#/d/${id}`);
        expect(toBob.recipient.email).toBe(U.bob);
        expect(toBob.context).toEqual({ decision_id: id, project: 'PRJ', actor: null });
        expect(toBob.priority).toBe('normal');
      });
    });
  });

  describe('GIVEN a delivered payload', () => {
    describe('WHEN it is validated', () => {
      it('THEN it is valid', async () => {
        const { mail } = await ran();
        const toBob = mail.calls.find((p) => p.recipient.user === U.bob)!;
        expect(validateNotificationPayload(toBob)).toEqual([]);
      });
    });
  });

  describe('GIVEN everything was already sent', () => {
    describe('WHEN the manager runs again', () => {
      it('THEN nothing is planned and nothing is re-sent', async () => {
        const { manager, mail } = await ran();
        const before = mail.calls.length;
        expect(await manager.run()).toEqual({ planned: 0, sent: 0, failed: 0, skipped: 0, retrying: 0 });
        expect(mail.calls.length).toBe(before);
      });
    });
  });
});

describe('preferences: muted types and disabled channels are respected', () => {
  async function withPreferences() {
    const mail = email();
    const ctx = await managed([mail], { settings: { mode: 'consensus_voting' } });
    ctx.log.setProfile(U.alice, U.alice, { preferences: { muted_types: ['vote_received'] } });
    ctx.log.setProfile(U.carol, U.carol, { preferences: { channels: { email: false } } });
    const id = proposed(ctx.log);
    act(ctx.log, id, U.bob, 'vote', { vote: 'approve' }); // -> alice (muted)
    await ctx.manager.run();
    return { ...ctx, mail };
  }

  describe('GIVEN alice muted vote_received', () => {
    describe('WHEN bob votes and the manager runs', () => {
      it('THEN alice gets no vote email', async () => {
        const { mail } = await withPreferences();
        expect(mail.calls.some((p: any) => p.recipient.user === U.alice && p.type === 'vote_received')).toBe(false);
      });
    });
  });

  describe('GIVEN carol disabled the email channel', () => {
    describe('WHEN the manager runs', () => {
      it('THEN carol gets no email', async () => {
        const { mail } = await withPreferences();
        expect(mail.calls.some((p: any) => p.recipient.user === U.carol)).toBe(false);
      });
    });
  });

  describe('GIVEN david has default preferences', () => {
    describe('WHEN the manager runs', () => {
      it('THEN david gets an email', async () => {
        const { mail } = await withPreferences();
        expect(mail.calls.some((p: any) => p.recipient.user === U.david)).toBe(true);
      });
    });
  });

  describe('GIVEN muted and disabled recipients', () => {
    describe('WHEN the manager runs', () => {
      it('THEN every notification is still marked planned', async () => {
        const { log } = await withPreferences();
        expect(log.store.notifications.every((n: any) => n.planned)).toBe(true);
      });
    });
  });
});

describe('several channels deliver seamlessly side by side; missing addresses are skipped', () => {
  async function allChannels() {
    const mail = email(), text = sms(), pushy = push();
    const ctx = await managed([mail, text, pushy]);
    ctx.log.setProfile(U.bob, U.bob, { phone: '+14155550123', push_tokens: ['tok'], preferences: { channels: { sms: true, push: true } } });
    ctx.log.setProfile(U.carol, U.carol, { preferences: { channels: { sms: true, push: true } } }); // enabled but no phone/token
    proposed(ctx.log);
    const stats = await ctx.manager.run();
    const forUser = (c: any, u: string) => c.calls.filter((p: any) => p.recipient.user === u).length;
    return { ...ctx, mail, text, pushy, stats, forUser };
  }

  describe('GIVEN bob has email, phone and a push token', () => {
    describe('WHEN the manager runs', () => {
      it('THEN he is notified once on each channel', async () => {
        const { mail, text, pushy, forUser } = await allChannels();
        expect([forUser(mail, U.bob), forUser(text, U.bob), forUser(pushy, U.bob)]).toEqual([1, 1, 1]);
      });
    });
  });

  describe('GIVEN carol enabled sms and push without addresses', () => {
    describe('WHEN the manager runs', () => {
      it('THEN she gets email only', async () => {
        const { mail, text, pushy, forUser } = await allChannels();
        expect([forUser(mail, U.carol), forUser(text, U.carol), forUser(pushy, U.carol)]).toEqual([1, 0, 0]);
      });
    });
  });

  describe('GIVEN carol lacks phone and token', () => {
    describe('WHEN the manager runs', () => {
      it('THEN two deliveries are skipped for no_address', async () => {
        const { log, stats } = await allChannels();
        expect(stats.skipped).toBe(2);
        expect(log.store.channel_deliveries.some((d: any) => d.channel === 'sms' && d.status === 'skipped' && d.last_error === 'no_address')).toBe(true);
      });
    });
  });
});

describe('fallback mode tries channels in order until one succeeds', () => {
  describe('GIVEN push and sms fail permanently', () => {
    describe('WHEN bob (fallback push, sms, email) is notified', () => {
      it('THEN each is tried once and email is the last resort', async () => {
        // Given
        const mail = email(), text = sms([failed('carrier rejected', { retryable: false })]), pushy = push([failed('token expired', { retryable: false })]);
        const { log, manager } = await managed([mail, text, pushy]);
        log.setProfile(U.bob, U.bob, { phone: '+14155550123', push_tokens: ['tok'], preferences: { mode: 'fallback', order: ['push', 'sms', 'email'], channels: { push: true, sms: true } } });
        proposed(log);
        // When
        await manager.run();
        // Then
        const toBob = (c: any) => c.calls.filter((p: any) => p.recipient.user === U.bob).length;
        expect(toBob(pushy)).toBe(1);
        expect(toBob(text)).toBe(1);
        expect(toBob(mail)).toBe(1);
      });
    });
  });

  describe('GIVEN push succeeds', () => {
    describe('WHEN bob (fallback push, email) is notified', () => {
      it('THEN no email is sent and its row is skipped as fallback_not_needed', async () => {
        // Given
        const mail = email(), pushOk = push();
        const { log, manager } = await managed([mail, pushOk]);
        log.setProfile(U.bob, U.bob, { push_tokens: ['tok'], preferences: { mode: 'fallback', order: ['push', 'email'], channels: { push: true } } });
        proposed(log);
        // When
        await manager.run();
        // Then
        expect(mail.calls.some((p: any) => p.recipient.user === U.bob)).toBe(false);
        const nid = log.store.notifications.find((n: any) => n.user === U.bob).id;
        const row = log.store.channel_deliveries.find((d: any) => d.channel === 'email' && d.notification_id === nid);
        expect(row.status).toBe('skipped');
        expect(row.last_error).toBe('fallback_not_needed');
      });
    });
  });
});

describe('retryable failures back off and give up; permanent failures stop immediately', () => {
  describe('GIVEN a channel that fails twice then succeeds', () => {
    describe('WHEN the manager first runs', () => {
      it('THEN the delivery retries after one minute', async () => {
        const flaky = email([failed('temporary'), failed('temporary'), sent('ok-1')]);
        const { manager, row } = await singleNotification(flaky);
        expect((await manager.run()).retrying).toBe(1);
        expect(row().attempts).toBe(1);
        expect(row().next_attempt_at).toBe('2024-03-20T10:01:00.000Z');
      });
    });
  });

  describe('GIVEN a failure that is not yet due', () => {
    describe('WHEN the manager runs again immediately', () => {
      it('THEN the channel is not called again', async () => {
        const flaky = email([failed('temporary'), failed('temporary'), sent('ok-1')]);
        const { manager } = await singleNotification(flaky);
        await manager.run();
        await manager.run();
        expect(flaky.calls.length).toBe(1);
      });
    });
  });

  describe('GIVEN a first failure', () => {
    describe('WHEN two minutes pass and the manager runs', () => {
      it('THEN the second failure backs off five more minutes', async () => {
        const flaky = email([failed('temporary'), failed('temporary'), sent('ok-1')]);
        const { clock, manager, row } = await singleNotification(flaky);
        await manager.run();
        clock.advanceMinutes(2);
        await manager.run();
        expect(row().next_attempt_at).toBe('2024-03-20T10:07:00.000Z');
      });
    });
  });

  describe('GIVEN two failures', () => {
    describe('WHEN the third attempt becomes due and succeeds', () => {
      it('THEN the row is sent with the provider id', async () => {
        const flaky = email([failed('temporary'), failed('temporary'), sent('ok-1')]);
        const { clock, manager, row } = await singleNotification(flaky);
        await manager.run();
        clock.advanceMinutes(2);
        await manager.run();
        clock.advanceMinutes(6);
        expect((await manager.run()).sent).toBe(1);
        expect(row().status).toBe('sent');
        expect(row().provider_id).toBe('ok-1');
      });
    });
  });

  describe('GIVEN a channel failing permanently', () => {
    describe('WHEN the manager runs', () => {
      it('THEN every delivery is failed after one attempt', async () => {
        const dead = email([failed('mailbox does not exist', { retryable: false })]);
        const { log, manager } = await managed([dead]);
        proposed(log);
        await manager.run();
        expect(log.store.channel_deliveries.every((d: any) => d.status === 'failed' && d.attempts === 1)).toBe(true);
      });
    });
  });

  describe('GIVEN a channel that always fails retryably', () => {
    describe('WHEN the manager runs six times 13 hours apart', () => {
      it('THEN it gives up as failed after five attempts', async () => {
        const down = email([failed('timeout')]);
        const { log, clock, manager } = await managed([down]);
        log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
        act(log, 'PRJ-001', U.alice, 'propose');
        for (let i = 0; i < 6; i++) { await manager.run(); clock.advanceHours(13); }
        const first = log.store.channel_deliveries[0];
        expect(first.status).toBe('failed');
        expect(first.attempts).toBe(5);
      });
    });
  });
});

describe('a channel that throws is treated as a retryable failure', () => {
  async function throwing() {
    const boom = email([new Error('socket hang up'), sent('fine')]);
    const ctx = await managed([boom]);
    proposed(ctx.log);
    return ctx;
  }

  describe('GIVEN a channel that throws', () => {
    describe('WHEN the manager runs', () => {
      it('THEN deliveries retry and the error text is recorded', async () => {
        const { log, manager } = await throwing();
        const stats = await manager.run();
        expect(stats.retrying).toBeGreaterThan(0);
        expect(log.store.channel_deliveries[0].last_error).toMatch(/socket hang up/);
      });
    });
  });

  describe('GIVEN a throw on the first attempt', () => {
    describe('WHEN two minutes pass and the manager runs', () => {
      it('THEN delivery succeeds', async () => {
        const { clock, manager } = await throwing();
        await manager.run();
        clock.advanceMinutes(2);
        expect((await manager.run()).sent).toBeGreaterThan(0);
      });
    });
  });
});

describe('a malformed result from a channel is a failure, not a crash', () => {
  describe('GIVEN a channel returning {ok:true}', () => {
    describe('WHEN the manager runs', () => {
      it('THEN it retries and records "invalid delivery result"', async () => {
        const { log, manager } = await managed([email([{ ok: true } as unknown as DeliveryResult])]);
        proposed(log);
        expect((await manager.run()).retrying).toBeGreaterThan(0);
        expect(log.store.channel_deliveries[0].last_error).toMatch(/invalid delivery result/i);
      });
    });
  });
});

describe('unregistered channels fail their pending rows instead of blocking the queue', () => {
  describe('GIVEN a pending delivery for an unknown channel', () => {
    describe('WHEN the manager runs', () => {
      it('THEN it fails with channel_not_registered', async () => {
        // Given
        const { log, manager } = await managed([email()]);
        proposed(log);
        await manager.run();
        log.store.channel_deliveries[0].status = 'pending';
        log.store.channel_deliveries[0].channel = 'carrier-pigeon';
        // When
        const stats = await manager.run();
        // Then
        expect(stats.failed).toBe(1);
        expect(log.store.channel_deliveries[0].last_error).toBe('channel_not_registered');
      });
    });
  });
});

describe('concurrent runs do not double-send', () => {
  describe('GIVEN a slow channel', () => {
    describe('WHEN two manager runs overlap', () => {
      it('THEN each notification is sent exactly once', async () => {
        // Given
        const slow = email();
        const original = slow.send.bind(slow);
        slow.send = async (p: any) => { await new Promise((r) => setTimeout(r, 10)); return original(p); };
        const { log, manager } = await managed([slow]);
        proposed(log);
        // When
        await Promise.all([manager.run(), manager.run()]);
        // Then
        const perNotification = new Map<string, number>();
        for (const p of slow.calls) perNotification.set(p.id, (perNotification.get(p.id) ?? 0) + 1);
        expect([...perNotification.values()].every((n) => n === 1)).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------- direct API for other services
describe('deliver() sends an ad-hoc payload through chosen channels without touching the queue', () => {
  describe('GIVEN email and sms channels and a recipient with only an email', () => {
    describe('WHEN deliver runs', () => {
      it('THEN email is sent and sms skipped for no_address', async () => {
        const { manager } = await managed([email(), sms()]);
        const results = await manager.deliver({ ...INPUT, recipient: { user: U.bob, email: U.bob } });
        expect(results.map((r: any) => [r.channel, r.result.status])).toEqual([['email', 'sent'], ['sms', 'skipped']]);
        expect(results[1].result).toEqual(skipped('no_address'));
      });
    });
  });

  describe('GIVEN email and sms channels', () => {
    describe('WHEN deliver is limited to sms', () => {
      it('THEN only sms is used', async () => {
        const { manager } = await managed([email(), sms()]);
        const only = await manager.deliver({ ...INPUT, recipient: { user: U.bob, email: U.bob, phone: '+14155550123' } }, { channels: ['sms'] });
        expect(only.map((r: any) => r.channel)).toEqual(['sms']);
      });
    });
  });

  describe('GIVEN a manager', () => {
    describe('WHEN deliver is given an invalid priority', () => {
      it('THEN it rejects', async () => {
        const { manager } = await managed([email(), sms()]);
        await expect(manager.deliver({ ...INPUT, priority: 'urgent' as NotificationPriority })).rejects.toThrow(/priority/);
      });
    });
    describe('WHEN deliver is limited to an unregistered channel', () => {
      it('THEN it rejects as not registered', async () => {
        const { manager } = await managed([email(), sms()]);
        await expect(manager.deliver(INPUT, { channels: ['fax'] })).rejects.toThrow(/not registered/i);
      });
    });
  });

  describe('GIVEN direct deliveries', () => {
    describe('WHEN the queue is inspected', () => {
      it('THEN no channel_deliveries were recorded', async () => {
        const { log, manager } = await managed([email(), sms()]);
        await manager.deliver({ ...INPUT, recipient: { user: U.bob, email: U.bob } });
        expect(log.store.channel_deliveries.length).toBe(0);
      });
    });
  });
});

// ---------------------------------------------------------------- persistence
describe('profiles, planning flags and channel deliveries survive a SQLite round trip', () => {
  async function restarted() {
    const file = tmpDbFile('dl-n-');
    const box = testBox();
    const clock = makeClock();
    const s1 = SqliteStore.open(file);
    const log = await buildLog({ store: s1, clock: clock.now, secretBox: box });
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
    const again = await buildLog({ store: s2, clock: clock.now, secretBox: box });
    return { s2, again };
  }

  describe('GIVEN a stored phone', () => {
    describe('WHEN the database is reopened', () => {
      it('THEN the profile is restored', async () => {
        const { again, s2 } = await restarted();
        expect(again.getProfile(U.bob, U.bob).phone).toBe('+14155550123');
        s2.close();
      });
    });
  });

  describe('GIVEN a sent delivery', () => {
    describe('WHEN the database is reopened', () => {
      it('THEN the sent channel delivery is restored', async () => {
        const { s2 } = await restarted();
        expect(s2.channel_deliveries.some((d: any) => d.status === 'sent')).toBe(true);
        s2.close();
      });
    });
  });

  describe('GIVEN planned notifications', () => {
    describe('WHEN the database is reopened and a manager runs', () => {
      it('THEN nothing is re-planned', async () => {
        const { again, s2 } = await restarted();
        const m2 = new NotificationManager(again);
        m2.register(email());
        expect((await m2.run()).planned).toBe(0);
        s2.close();
      });
    });
  });
});

// ---------------------------------------------------------------- operational safety
describe('old notifications are never sent: enabling a channel later does not blast the backlog', () => {
  async function backlog() {
    const mail = email();
    const ctx = await managed([mail]);
    proposed(ctx.log);
    ctx.clock.advanceHours(30); // the manager was not running (e.g. SMTP not configured yet)
    const fresh = proposed(ctx.log, { title: 'fresh one' });
    const stats = await ctx.manager.run();
    return { ...ctx, mail, fresh, stats };
  }

  describe('GIVEN a 30-hour-old backlog and a fresh proposal', () => {
    describe('WHEN the manager first runs', () => {
      it('THEN only the fresh one is delivered', async () => {
        const { mail, fresh } = await backlog();
        expect(mail.calls.length).toBeGreaterThan(0);
        expect(mail.calls.every((p: any) => p.content.title.startsWith(`[${fresh}]`))).toBe(true);
      });
    });
  });

  describe('GIVEN a stale backlog', () => {
    describe('WHEN the manager runs', () => {
      it('THEN stale notifications are retired as planned, not left pending', async () => {
        const { log, stats } = await backlog();
        expect(log.store.notifications.every((n: any) => n.planned)).toBe(true);
        expect(stats.planned).toBe(log.store.notifications.length);
      });
    });
  });
});

describe('pruneChannelDeliveries drops finished rows after the retention window, keeping pending ones', () => {
  async function pendingRows() {
    const ctx = await managed([email([failed('temporary')])]);
    proposed(ctx.log);
    await ctx.manager.run(); // everything fails once and stays pending
    ctx.clock.advanceDays(40);
    return ctx;
  }

  describe('GIVEN pending rows older than the window', () => {
    describe('WHEN pruned', () => {
      it('THEN none are removed', async () => {
        const { log } = await pendingRows();
        expect(log.pruneChannelDeliveries({ olderThanDays: 30 })).toEqual({ removed: 0 });
        expect(log.store.channel_deliveries.length).toBeGreaterThan(0);
      });
    });
  });

  describe('GIVEN finished rows older than the window', () => {
    describe('WHEN pruned', () => {
      it('THEN all are removed', async () => {
        const { log } = await pendingRows();
        const total = log.store.channel_deliveries.length;
        log.store.channel_deliveries.forEach((d: any, i: number) => { d.status = i % 2 ? 'sent' : 'failed'; });
        expect(log.pruneChannelDeliveries({ olderThanDays: 30 })).toEqual({ removed: total });
        expect(log.store.channel_deliveries.length).toBe(0);
      });
    });
  });
});
