import { describe, it, expect, beforeEach } from 'bun:test';
import {
  Notifier, NotificationDispatcher, SqliteStore, buildLog, freshLog, proposed, act, makeClock, testBox, tmpDbFile, onCleanup, U,
  email, sms, push, sentResult, failedResult, SUBSCRIPTION,
  type FakeChannel, type LogHandle, type NotificationChannel,
} from './support/index';

// The dispatcher is the project-side glue (in-app notifications + profiles -> Notifier.send, with persistence and retries).
// The notifications module itself knows none of this; see notifications.spec.ts for the tool.
//
// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// THEN may read the store to observe the outcome. A proposal notifies bob, carol, david and the lead (four notifications).

const APP_URL = 'https://dl.example.com';
type Stats = Awaited<ReturnType<NotificationDispatcher['run']>>;
type Dispatching = LogHandle & { channels: FakeChannel[]; manager: NotificationDispatcher };

const dispatcherFor = (log: any, channels: NotificationChannel[], options: { appUrl?: string } = {}) => {
  const notifier = new Notifier();
  for (const c of channels) notifier.register(c);
  return new NotificationDispatcher(log, notifier, options);
};

/** Call inside a describe(): a fresh log, fresh channels from `makeChannels`, and a dispatcher (`manager`) over them. */
function dispatching(makeChannels: () => FakeChannel[], settings?: Record<string, any>): Dispatching {
  const h = freshLog(settings) as Dispatching;
  beforeEach(() => {
    h.channels = makeChannels();
    h.manager = dispatcherFor(h.log, h.channels, { appUrl: APP_URL });
  });
  return h;
}

/** Call inside a describe(): dispatching() plus a proposed PRJ-001 (four notifications). */
function proposalWith(makeChannels: () => FakeChannel[], settings?: Record<string, any>): Dispatching {
  const h = dispatching(makeChannels, settings);
  beforeEach(() => { proposed(h.log); });
  return h;
}

/** Call inside a describe(): one proposed decision whose single notification (to bob) is kept, so the delivery row is predictable. */
function singleNotification(makeChannel: () => FakeChannel) {
  const h = dispatching(() => [makeChannel()]) as Dispatching & { row: () => any };
  beforeEach(() => {
    proposed(h.log);
    h.log.store.notifications.splice(1);
    const only = h.log.store.notifications[0];
    h.row = () => h.log.store.channel_deliveries.find((d: any) => d.notification_id === only.id);
  });
  return h;
}

// ---------------------------------------------------------------- manager runs
describe('in-app notifications are turned into standard payloads and sent once', () => {
  describe('GIVEN a proposal that notified four people', () => {
    const h = proposalWith(() => [email()]);

    describe('WHEN the manager runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN every one is planned and sent', () => {
        const [mail] = h.channels;
        expect(h.log.store.notifications.length).toBe(4);
        expect(stats.planned).toBe(4);
        expect(stats.sent).toBe(4);
        expect(mail!.calls.length).toBe(4);
      });

      it('THEN bob\'s email payload has the standard title, body, link, addresses and data', () => {
        const toBob = h.channels[0]!.payloads.find((p) => p.recipient.user === U.bob)!;
        expect(toBob.type).toBe('decision_proposed');
        expect(toBob.title).toBe('[PRJ-001] Decision proposed for review');
        expect(toBob.body).toMatch(/was proposed/);
        expect(toBob.link).toBe(`${APP_URL}/#/d/PRJ-001`);
        expect(toBob.recipient.addresses.email).toEqual([U.bob]);
        expect(toBob.data).toEqual({ decision_id: 'PRJ-001', project: 'PRJ', actor: null });
      });
    });
  });

  describe('GIVEN everything was already sent', () => {
    const h = proposalWith(() => [email()]);
    let sentBefore: number;
    beforeEach(async () => {
      await h.manager.run();
      sentBefore = h.channels[0]!.calls.length;
    });

    describe('WHEN the manager runs again', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN nothing is planned and nothing is re-sent', () => {
        expect(stats).toEqual({ planned: 0, sent: 0, failed: 0, skipped: 0, retrying: 0 });
        expect(h.channels[0]!.calls.length).toBe(sentBefore);
      });
    });
  });
});

describe('preferences: muted types and disabled channels are respected', () => {
  describe('GIVEN alice muted vote_received, carol disabled email, and bob voted on alice\'s proposal', () => {
    const h = dispatching(() => [email()], { mode: 'consensus_voting' });
    beforeEach(() => {
      h.log.setProfile(U.alice, U.alice, { preferences: { muted_types: ['vote_received'] } });
      h.log.setProfile(U.carol, U.carol, { preferences: { channels: { email: false } } });
      const id = proposed(h.log);
      act(h.log, id, U.bob, 'vote', { vote: 'approve' }); // -> alice (muted)
    });
    const mailed = (pred: (p: any) => boolean) => h.channels[0]!.payloads.some(pred);

    describe('WHEN the manager runs', () => {
      beforeEach(async () => { await h.manager.run(); });

      it('THEN alice gets no vote email', () => {
        expect(mailed((p) => p.recipient.user === U.alice && p.type === 'vote_received')).toBe(false);
      });

      it('THEN carol gets no email', () => {
        expect(mailed((p) => p.recipient.user === U.carol)).toBe(false);
      });

      it('THEN david, with default preferences, gets an email', () => {
        expect(mailed((p) => p.recipient.user === U.david)).toBe(true);
      });

      it('THEN every notification is still marked planned', () => {
        expect(h.log.store.notifications.every((n: any) => n.planned)).toBe(true);
      });
    });
  });
});

describe('several channels deliver seamlessly side by side; missing addresses are skipped', () => {
  describe('GIVEN bob reachable on email, sms and push, carol with sms and push enabled but no addresses, and a proposal', () => {
    const h = dispatching(() => [email(), sms(), push()]);
    beforeEach(() => {
      h.log.setProfile(U.bob, U.bob, { phone: '+14155550123', push_subscriptions: [SUBSCRIPTION], preferences: { channels: { sms: true, push: true } } });
      h.log.setProfile(U.carol, U.carol, { preferences: { channels: { sms: true, push: true } } });
      proposed(h.log);
    });
    const perChannel = (user: string) => h.channels.map((c) => c.payloads.filter((p) => p.recipient.user === user).length);

    describe('WHEN the manager runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN bob is notified once on each channel', () => {
        expect(perChannel(U.bob)).toEqual([1, 1, 1]);
      });

      it('THEN carol gets email only', () => {
        expect(perChannel(U.carol)).toEqual([1, 0, 0]);
      });

      it('THEN carol\'s sms and push deliveries are skipped for no_address', () => {
        expect(stats.skipped).toBe(2);
        expect(h.log.store.channel_deliveries.some((d: any) => d.channel === 'sms' && d.status === 'skipped' && d.last_error === 'no_address')).toBe(true);
      });
    });
  });
});

describe('retryable failures back off and give up; permanent failures stop immediately', () => {
  const failsTwiceThenSends = () => email([failedResult('temporary'), failedResult('temporary'), sentResult('ok-1')]);

  describe('GIVEN a channel that fails twice then succeeds', () => {
    const h = singleNotification(failsTwiceThenSends);

    describe('WHEN the manager first runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN the delivery retries after one minute', () => {
        expect(stats.retrying).toBe(1);
        expect(h.row().attempts).toBe(1);
        expect(h.row().next_attempt_at).toBe('2024-03-20T10:01:00.000Z');
      });
    });
  });

  describe('GIVEN a failure that is not yet due', () => {
    const h = singleNotification(failsTwiceThenSends);
    beforeEach(async () => { await h.manager.run(); });

    describe('WHEN the manager runs again immediately', () => {
      beforeEach(async () => { await h.manager.run(); });

      it('THEN the channel is not called again', () => {
        expect(h.channels[0]!.calls.length).toBe(1);
      });
    });
  });

  describe('GIVEN a first failure two minutes ago', () => {
    const h = singleNotification(failsTwiceThenSends);
    beforeEach(async () => {
      await h.manager.run();
      h.clock.advanceMinutes(2);
    });

    describe('WHEN the manager runs', () => {
      beforeEach(async () => { await h.manager.run(); });

      it('THEN the second failure backs off five more minutes', () => {
        expect(h.row().next_attempt_at).toBe('2024-03-20T10:07:00.000Z');
      });
    });
  });

  describe('GIVEN two failures and the third attempt now due', () => {
    const h = singleNotification(failsTwiceThenSends);
    beforeEach(async () => {
      await h.manager.run();
      h.clock.advanceMinutes(2);
      await h.manager.run();
      h.clock.advanceMinutes(6);
    });

    describe('WHEN the manager runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN the row is sent with the provider id', () => {
        expect(stats.sent).toBe(1);
        expect(h.row().status).toBe('sent');
        expect(h.row().provider_id).toBe('ok-1');
      });
    });
  });

  describe('GIVEN a channel failing permanently and a proposal', () => {
    const h = proposalWith(() => [email([failedResult('mailbox does not exist', { retryable: false })])]);

    describe('WHEN the manager runs', () => {
      beforeEach(async () => { await h.manager.run(); });

      it('THEN every delivery is failed after one attempt', () => {
        expect(h.log.store.channel_deliveries.every((d: any) => d.status === 'failed' && d.attempts === 1)).toBe(true);
      });
    });
  });

  describe('GIVEN a channel that always fails retryably and a proposal', () => {
    const h = proposalWith(() => [email([failedResult('timeout')])]);

    describe('WHEN the manager runs six times 13 hours apart', () => {
      beforeEach(async () => {
        for (let i = 0; i < 6; i++) { await h.manager.run(); h.clock.advanceHours(13); }
      });

      it('THEN it gives up as failed after five attempts', () => {
        const first = h.log.store.channel_deliveries[0];
        expect(first.status).toBe('failed');
        expect(first.attempts).toBe(5);
      });
    });
  });
});

describe('a channel that throws is treated as a retryable failure', () => {
  const throwsOnce = () => [email([new Error('socket hang up'), sentResult('fine')])];

  describe('GIVEN a channel whose first send throws, and a proposal', () => {
    const h = proposalWith(throwsOnce);

    describe('WHEN the manager runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN the throwing delivery retries with its error recorded; the other three are sent', () => {
        expect(stats).toMatchObject({ sent: 3, retrying: 1 }); // only the first send throws
        expect(h.log.store.channel_deliveries[0].last_error).toMatch(/socket hang up/);
      });
    });
  });

  describe('GIVEN a throw on the first attempt two minutes ago', () => {
    const h = proposalWith(throwsOnce);
    beforeEach(async () => {
      await h.manager.run();
      h.clock.advanceMinutes(2);
    });

    describe('WHEN the manager runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN the retried delivery is sent', () => {
        expect(stats.sent).toBe(1);
      });
    });
  });
});

describe('unregistered channels fail their pending rows instead of blocking the queue', () => {
  describe('GIVEN a pending delivery for an unknown channel', () => {
    const h = proposalWith(() => [email()]);
    beforeEach(async () => {
      await h.manager.run();
      h.log.store.channel_deliveries[0].status = 'pending';
      h.log.store.channel_deliveries[0].channel = 'carrier-pigeon';
    });

    describe('WHEN the manager runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN it fails with channel_not_registered', () => {
        expect(stats.failed).toBe(1);
        expect(h.log.store.channel_deliveries[0].last_error).toBe('channel_not_registered');
      });
    });
  });
});

describe('concurrent runs do not double-send', () => {
  /** An email channel that takes 10ms per send. */
  const slowEmail = () => {
    const slow = email();
    const original = slow.send.bind(slow);
    slow.send = async (p, addresses) => { await new Promise((r) => setTimeout(r, 10)); return original(p, addresses); };
    return [slow];
  };

  describe('GIVEN a slow channel and a proposal', () => {
    const h = proposalWith(slowEmail);

    describe('WHEN two manager runs overlap', () => {
      beforeEach(async () => { await Promise.all([h.manager.run(), h.manager.run()]); });

      it('THEN each notification is sent exactly once', () => {
        const slow = h.channels[0]!;
        const perNotification = new Map<string, number>();
        for (const p of slow.payloads) perNotification.set(p.id, (perNotification.get(p.id) ?? 0) + 1);
        expect(slow.calls.length).toBe(4);
        expect([...perNotification.values()]).toEqual([1, 1, 1, 1]);
      });
    });
  });
});

// ---------------------------------------------------------------- persistence
describe('profiles, planning flags and channel deliveries survive a SQLite round trip', () => {
  /** bob's phone, a planned and sent notification, committed to SQLite; `open()` reopens it (closed after the test). */
  function committed() {
    const ctx = {} as { open: () => Promise<any> };
    beforeEach(async () => {
      const file = tmpDbFile('dl-n-');
      const box = testBox();
      const clock = makeClock();
      const s1 = SqliteStore.open(file);
      const log = await buildLog({ store: s1, clock: clock.now, secretBox: box });
      log.createOwner({ identifier: 'acme' });
      for (const u of [U.alice, U.bob]) log.addTeamMember({ owner: 'acme', user: u, actor: 'acme' });
      log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
      log.setProfile(U.bob, U.bob, { phone: '+14155550123' });
      proposed(log);
      await dispatcherFor(log, [email()]).run();
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

  describe('GIVEN a stored phone and a sent delivery, committed', () => {
    const ctx = committed();

    describe('WHEN the database is reopened', () => {
      let again: any;
      beforeEach(async () => { again = await ctx.open(); });

      it('THEN the profile is restored', () => {
        expect(again.getProfile(U.bob, U.bob).phone).toBe('+14155550123');
      });

      it('THEN the sent channel delivery is restored', () => {
        expect(again.store.channel_deliveries.some((d: any) => d.status === 'sent')).toBe(true);
      });
    });
  });

  describe('GIVEN planned notifications in a reopened database', () => {
    const ctx = committed();
    let again: any;
    beforeEach(async () => { again = await ctx.open(); });

    describe('WHEN a new manager runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await dispatcherFor(again, [email()]).run(); });

      it('THEN nothing is re-planned', () => {
        expect(stats.planned).toBe(0);
      });
    });
  });
});

// ---------------------------------------------------------------- operational safety
describe('old notifications are never sent: enabling a channel later does not blast the backlog', () => {
  describe('GIVEN a 30-hour-old backlog and a fresh proposal', () => {
    const h = dispatching(() => [email()]);
    let fresh: string;
    beforeEach(() => {
      proposed(h.log);
      h.clock.advanceHours(30); // the manager was not running (e.g. SMTP not configured yet)
      fresh = proposed(h.log, { title: 'fresh one' });
    });

    describe('WHEN the manager first runs', () => {
      let stats: Stats;
      beforeEach(async () => { stats = await h.manager.run(); });

      it('THEN only the fresh one is delivered', () => {
        const mail = h.channels[0]!;
        expect(mail.calls.length).toBe(4);
        expect(mail.payloads.every((p) => p.title.startsWith(`[${fresh}]`))).toBe(true);
      });

      it('THEN stale notifications are retired as planned, not left pending', () => {
        expect(h.log.store.notifications.every((n: any) => n.planned)).toBe(true);
        expect(h.log.store.notifications.length).toBe(8);
        expect(stats.planned).toBe(8);
      });
    });
  });
});

describe('pruneChannelDeliveries drops finished rows after the retention window, keeping pending ones', () => {
  /** Four rows that failed once and stay pending, now 40 days old. */
  function pendingRows() {
    const h = proposalWith(() => [email([failedResult('temporary')])]);
    beforeEach(async () => {
      await h.manager.run();
      h.clock.advanceDays(40);
    });
    return h;
  }

  describe('GIVEN pending rows older than the window', () => {
    const h = pendingRows();

    describe('WHEN pruned at 30 days', () => {
      let result: any;
      beforeEach(() => { result = h.log.pruneChannelDeliveries({ olderThanDays: 30 }); });

      it('THEN none are removed', () => {
        expect(result).toEqual({ removed: 0 });
        expect(h.log.store.channel_deliveries.length).toBe(4);
      });
    });
  });

  describe('GIVEN finished (sent or failed) rows older than the window', () => {
    const h = pendingRows();
    let total: number;
    beforeEach(() => {
      total = h.log.store.channel_deliveries.length;
      h.log.store.channel_deliveries.forEach((d: any, i: number) => { d.status = i % 2 ? 'sent' : 'failed'; });
    });

    describe('WHEN pruned at 30 days', () => {
      let result: any;
      beforeEach(() => { result = h.log.pruneChannelDeliveries({ olderThanDays: 30 }); });

      it('THEN all are removed', () => {
        expect(result).toEqual({ removed: total });
        expect(h.log.store.channel_deliveries.length).toBe(0);
      });
    });
  });
});
