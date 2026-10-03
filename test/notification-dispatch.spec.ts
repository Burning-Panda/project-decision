import { describe, it, expect } from 'bun:test';
import {
  Notifier, SqliteStore, buildLog, setup, proposed, act, makeClock, testBox, tmpDbFile, U,
  email, sms, push, sentResult, failedResult, SUBSCRIPTION,
  type NotificationChannel,
} from './support/index';
import { NotificationDispatcher } from '../src/decision-log/notifications/notification-dispatcher';

// The dispatcher is the project-side glue (in-app notifications + profiles -> Notifier.send, with persistence and retries).
// The notifications module itself knows none of this; see notifications.spec.ts for the tool.

const dispatcherFor = (log: any, channels: NotificationChannel[], options: { appUrl?: string } = {}) => {
  const notifier = new Notifier();
  for (const c of channels) notifier.register(c);
  return new NotificationDispatcher(log, notifier, options);
};

async function managed(channels: NotificationChannel[], { settings, appUrl = 'https://dl.example.com' }: { settings?: Record<string, any>; appUrl?: string } = {}) {
  const ctx = await setup(settings);
  return { ...ctx, manager: dispatcherFor(ctx.log, channels, { appUrl }) };
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
        expect(log.store.notifications.length).toBe(4);
        expect(stats.planned).toBe(4);
        expect(stats.sent).toBe(4);
        expect(mail.calls.length).toBe(4);
      });
    });
  });

  describe('GIVEN a proposal', () => {
    describe('WHEN the manager runs', () => {
      it('THEN bob\'s email payload has the standard title, body, link, addresses and data', async () => {
        const { mail, id } = await ran();
        const toBob = mail.payloads.find((p) => p.recipient.user === U.bob)!;
        expect(toBob.type).toBe('decision_proposed');
        expect(toBob.title).toBe(`[${id}] Decision proposed for review`);
        expect(toBob.body).toMatch(/was proposed/);
        expect(toBob.link).toBe(`https://dl.example.com/#/d/${id}`);
        expect(toBob.recipient.addresses.email).toEqual([U.bob]);
        expect(toBob.data).toEqual({ decision_id: id, project: 'PRJ', actor: null });
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
        expect(mail.payloads.some((p: any) => p.recipient.user === U.alice && p.type === 'vote_received')).toBe(false);
      });
    });
  });

  describe('GIVEN carol disabled the email channel', () => {
    describe('WHEN the manager runs', () => {
      it('THEN carol gets no email', async () => {
        const { mail } = await withPreferences();
        expect(mail.payloads.some((p: any) => p.recipient.user === U.carol)).toBe(false);
      });
    });
  });

  describe('GIVEN david has default preferences', () => {
    describe('WHEN the manager runs', () => {
      it('THEN david gets an email', async () => {
        const { mail } = await withPreferences();
        expect(mail.payloads.some((p: any) => p.recipient.user === U.david)).toBe(true);
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
    ctx.log.setProfile(U.bob, U.bob, { phone: '+14155550123', push_subscriptions: [SUBSCRIPTION], preferences: { channels: { sms: true, push: true } } });
    ctx.log.setProfile(U.carol, U.carol, { preferences: { channels: { sms: true, push: true } } }); // enabled but no phone/subscription
    proposed(ctx.log);
    const stats = await ctx.manager.run();
    const forUser = (c: any, u: string) => c.payloads.filter((p: any) => p.recipient.user === u).length;
    return { ...ctx, mail, text, pushy, stats, forUser };
  }

  describe('GIVEN bob has email, phone and a push subscription', () => {
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

  describe('GIVEN carol lacks phone and push subscription', () => {
    describe('WHEN the manager runs', () => {
      it('THEN two deliveries are skipped for no_address', async () => {
        const { log, stats } = await allChannels();
        expect(stats.skipped).toBe(2);
        expect(log.store.channel_deliveries.some((d: any) => d.channel === 'sms' && d.status === 'skipped' && d.last_error === 'no_address')).toBe(true);
      });
    });
  });
});

describe('retryable failures back off and give up; permanent failures stop immediately', () => {
  describe('GIVEN a channel that fails twice then succeeds', () => {
    describe('WHEN the manager first runs', () => {
      it('THEN the delivery retries after one minute', async () => {
        const flaky = email([failedResult('temporary'), failedResult('temporary'), sentResult('ok-1')]);
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
        const flaky = email([failedResult('temporary'), failedResult('temporary'), sentResult('ok-1')]);
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
        const flaky = email([failedResult('temporary'), failedResult('temporary'), sentResult('ok-1')]);
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
        const flaky = email([failedResult('temporary'), failedResult('temporary'), sentResult('ok-1')]);
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
        const dead = email([failedResult('mailbox does not exist', { retryable: false })]);
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
        const down = email([failedResult('timeout')]);
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
    const boom = email([new Error('socket hang up'), sentResult('fine')]);
    const ctx = await managed([boom]);
    proposed(ctx.log);
    return ctx;
  }

  describe('GIVEN a channel that throws', () => {
    describe('WHEN the manager runs', () => {
      it('THEN the throwing delivery retries with its error recorded; the other three are sent', async () => {
        const { log, manager } = await throwing();
        const stats = await manager.run();
        expect(stats).toMatchObject({ sent: 3, retrying: 1 }); // only the first send throws
        expect(log.store.channel_deliveries[0].last_error).toMatch(/socket hang up/);
      });
    });
  });

  describe('GIVEN a throw on the first attempt', () => {
    describe('WHEN two minutes pass and the manager runs', () => {
      it('THEN the retried delivery is sent', async () => {
        const { clock, manager } = await throwing();
        await manager.run();
        clock.advanceMinutes(2);
        expect((await manager.run()).sent).toBe(1);
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
        slow.send = async (p, addresses) => { await new Promise((r) => setTimeout(r, 10)); return original(p, addresses); };
        const { log, manager } = await managed([slow]);
        proposed(log);
        // When
        await Promise.all([manager.run(), manager.run()]);
        // Then
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
    const manager = dispatcherFor(log, [email()]);
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
        const m2 = dispatcherFor(again, [email()]);
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
        expect(mail.calls.length).toBe(4);
        expect(mail.payloads.every((p: any) => p.title.startsWith(`[${fresh}]`))).toBe(true);
      });
    });
  });

  describe('GIVEN a stale backlog', () => {
    describe('WHEN the manager runs', () => {
      it('THEN stale notifications are retired as planned, not left pending', async () => {
        const { log, stats } = await backlog();
        expect(log.store.notifications.every((n: any) => n.planned)).toBe(true);
        expect(log.store.notifications.length).toBe(8);
        expect(stats.planned).toBe(8);
      });
    });
  });
});

describe('pruneChannelDeliveries drops finished rows after the retention window, keeping pending ones', () => {
  async function pendingRows() {
    const ctx = await managed([email([failedResult('temporary')])]);
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
        expect(log.store.channel_deliveries.length).toBe(4);
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

