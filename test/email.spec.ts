import { describe, it, expect, beforeEach } from 'bun:test';
import {
  EmailChannel, MemoryMailTransport, Notifier, NotificationDispatcher, smtpTransport, setup, proposed, PAYLOAD, U,
  type DeliveryResult, type MailMessage, type MailTransport, type NotificationPayload,
} from './support/index';
import { startMockSmtp } from './support/mock-smtp';

const FROM = 'Decision Log <noreply@example.com>';
const payload: NotificationPayload = {
  ...PAYLOAD,
  id: 'notif-007',
  title: '[PRJ-001] Decision <b>proposed</b>',
  body: 'Alice proposed "Use Postgres" & more.\nSecond line.',
  link: 'https://dl.example.com/#/d/PRJ-001',
};
const failingWith = (error: Error): MailTransport => ({ async send() { throw error; } });

// ---------------------------------------------------------------- EmailChannel
describe('EmailChannel is named email and needs a from address and a transport', () => {
  describe('GIVEN valid options', () => {
    describe('WHEN the channel is built', () => {
      let channel: EmailChannel;
      beforeEach(() => { channel = new EmailChannel({ transport: new MemoryMailTransport(), from: FROM }); });

      it('THEN its name is email', () => {
        expect(channel.name).toBe('email');
      });
    });
  });

  const invalid: Array<[string, unknown, RegExp]> = [
    ['no from', { transport: new MemoryMailTransport() }, /from/],
    ['no transport', { from: FROM }, /transport/],
    ['a transport without send', { transport: {}, from: FROM }, /transport/],
  ];
  for (const [label, options, error] of invalid) {
    describe(`GIVEN ${label}`, () => {
      describe('WHEN the channel is built', () => {
        let build: () => unknown;
        beforeEach(() => { build = () => new EmailChannel(options as never); });

        it(`THEN it throws matching ${error}`, () => {
          expect(build).toThrow(error);
        });
      });
    });
  }
});

describe('EmailChannel renders safe text and HTML with a stable Message-ID', () => {
  describe('GIVEN an email channel with a reply-to address', () => {
    let transport: MemoryMailTransport;
    let channel: EmailChannel;
    beforeEach(() => {
      transport = new MemoryMailTransport();
      channel = new EmailChannel({ transport, from: FROM, replyTo: 'help@example.com' });
    });

    describe('WHEN a notification is sent', () => {
      let result: DeliveryResult;
      let m: MailMessage;
      beforeEach(async () => {
        result = await channel.send(payload, ['bob@acme.com']);
        m = transport.sent[0]!;
      });

      it('THEN the result is sent with the Message-ID as provider id', () => {
        expect(result).toEqual({ status: 'sent', provider_id: '<notif-007@example.com>' });
      });

      it('THEN envelope fields come from the addresses, payload and options', () => {
        expect(m.to).toEqual(['bob@acme.com']);
        expect(m.from).toBe(FROM);
        expect(m.replyTo).toBe('help@example.com');
        expect(m.subject).toBe('[PRJ-001] Decision <b>proposed</b>');
      });

      it('THEN the text carries the body and the link', () => {
        expect(m.text).toBe('Alice proposed "Use Postgres" & more.\nSecond line.\n\nhttps://dl.example.com/#/d/PRJ-001');
      });

      it('THEN the HTML escapes the body, keeps line breaks and links', () => {
        expect(m.html).toContain('Alice proposed &quot;Use Postgres&quot; &amp; more.<br>Second line.');
        expect(m.html).toContain('<a href="https://dl.example.com/#/d/PRJ-001">');
      });

      it('THEN it is marked auto-generated', () => {
        expect(m.headers['Auto-Submitted']).toBe('auto-generated');
      });
    });

    describe('WHEN the same notification is sent twice (a retry)', () => {
      beforeEach(async () => {
        await channel.send(payload, ['bob@acme.com']);
        await channel.send(payload, ['bob@acme.com']);
      });

      it('THEN both messages share the Message-ID', () => {
        expect(transport.sent[1]!.messageId).toBe(transport.sent[0]!.messageId);
      });
    });

    describe('WHEN the title contains CRLF and a Bcc header', () => {
      beforeEach(async () => { await channel.send({ ...payload, title: 'Line one\r\nBcc: x@y.zz' }, ['bob@acme.com']); });

      it('THEN the subject is flattened to one line', () => {
        expect(transport.sent[0]!.subject).toBe('Line one Bcc: x@y.zz');
      });
    });
  });
});

describe('EmailChannel maps transport errors onto retryable or permanent failures', () => {
  const cases: Array<[string, Error, boolean]> = [
    ['a retryable transport error', Object.assign(new Error('451 try later'), { retryable: true }), true],
    ['a permanent transport error', Object.assign(new Error('550 no such user'), { retryable: false }), false],
    ['an error with no retryable flag', new Error('weird'), true],
  ];
  for (const [label, error, retryable] of cases) {
    describe(`GIVEN ${label}`, () => {
      let channel: EmailChannel;
      beforeEach(() => { channel = new EmailChannel({ from: FROM, transport: failingWith(error) }); });

      describe('WHEN a notification is sent', () => {
        let result: DeliveryResult;
        beforeEach(async () => { result = await channel.send(payload, ['bob@acme.com']); });

        it(`THEN the result is failed with retryable ${retryable}`, () => {
          expect(result).toEqual({ status: 'failed', error: error.message, retryable });
        });
      });
    });
  }
});

// ---------------------------------------------------------------- smtpTransport (nodemailer against a local mock server)
describe('smtpTransport delivers over SMTP and classifies rejections', () => {
  describe('GIVEN an SMTP server that accepts everything', () => {
    let server: Awaited<ReturnType<typeof startMockSmtp>>;
    beforeEach(async () => { server = await startMockSmtp(); });

    describe('WHEN the email channel sends through it', () => {
      let result: DeliveryResult;
      beforeEach(async () => {
        const channel = new EmailChannel({ transport: smtpTransport(`smtp://127.0.0.1:${server.port}`), from: FROM });
        result = await channel.send(payload, ['bob@acme.com']);
      });

      it('THEN the result is sent', () => {
        expect(result.status).toBe('sent');
      });

      it('THEN the server received one message for bob with the subject and link', () => {
        const [session] = server.sessions.filter((s: any) => s.message);
        expect(session.rcpts).toEqual(['bob@acme.com']);
        expect(session.message).toContain('Subject: [PRJ-001] Decision <b>proposed</b>');
        expect(session.message).toContain('https://dl.example.com/#/d/PRJ-001');
      });
    });
  });

  const rejections: Array<[string, string, boolean]> = [
    ['greylists bob (451)', '451 4.2.1 greylisted, try again', true],
    ['does not know bob (550)', '550 5.1.1 no such user', false],
  ];
  for (const [label, reply, retryable] of rejections) {
    describe(`GIVEN an SMTP server that ${label}`, () => {
      let server: Awaited<ReturnType<typeof startMockSmtp>>;
      beforeEach(async () => { server = await startMockSmtp({ rcpt: { 'bob@acme.com': reply } }); });

      describe('WHEN the email channel sends to bob', () => {
        let result: DeliveryResult;
        beforeEach(async () => {
          const channel = new EmailChannel({ transport: smtpTransport(`smtp://127.0.0.1:${server.port}`), from: FROM });
          result = await channel.send(payload, ['bob@acme.com']);
        });

        it(`THEN the result is failed with retryable ${retryable}`, () => {
          expect(result.status).toBe('failed');
          expect(result.status === 'failed' && result.retryable).toBe(retryable);
        });
      });
    });
  }
});

// ---------------------------------------------------------------- end to end: dispatcher -> Notifier -> EmailChannel -> SMTP
describe('end to end: team members receive real emails over SMTP, and transient failures are retried', () => {
  describe('GIVEN carol is greylisted', () => {
    let ctx: { server: Awaited<ReturnType<typeof startMockSmtp>>; dispatcher: NotificationDispatcher; id: string };
    beforeEach(async () => {
      const server = await startMockSmtp({ rcpt: { 'carol@acme.com': '451 4.2.1 greylisted, try again' } });
      const { log } = await setup();
      const notifier = new Notifier().register(new EmailChannel({ transport: smtpTransport(`smtp://127.0.0.1:${server.port}`), from: FROM }));
      ctx = { server, dispatcher: new NotificationDispatcher(log, notifier, { appUrl: 'https://dl.example.com' }), id: proposed(log) };
    });

    describe('WHEN the dispatcher runs', () => {
      let stats: Awaited<ReturnType<NotificationDispatcher['run']>>;
      beforeEach(async () => { stats = await ctx.dispatcher.run(); });

      it('THEN three emails are sent and one is retrying', () => {
        expect(stats.sent).toBe(3);
        expect(stats.retrying).toBe(1);
      });

      it('THEN bob, david and the lead receive mail', () => {
        const mails = ctx.server.sessions.filter((s: any) => s.message);
        expect(mails.map((s: any) => s.rcpts[0]).sort((a: string, b: string) => a.localeCompare(b))).toEqual(['bob@acme.com', 'david@acme.com', 'lead@acme.com']);
      });

      it('THEN bob\'s subject names the decision and the text links to it', () => {
        const bob = ctx.server.sessions.find((s: any) => s.message && s.rcpts[0] === U.bob)!;
        expect(bob.message).toContain(`Subject: [${ctx.id}] Decision proposed for review`);
        expect(bob.message).toContain(`https://dl.example.com/#/d/${ctx.id}`);
      });
    });
  });
});

describe('end to end retry: the greylisted recipient succeeds on the next attempt', () => {
  describe('GIVEN a transport that fails once', () => {
    let ctx: Awaited<ReturnType<typeof setup>> & { dispatcher: NotificationDispatcher };
    beforeEach(async () => {
      let attempts = 0;
      const flaky: MailTransport = {
        async send(message) {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error('451 greylisted'), { retryable: true });
          return { id: message.messageId };
        },
      };
      const base = await setup();
      const notifier = new Notifier().register(new EmailChannel({ transport: flaky, from: 'noreply@example.com' }));
      base.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
      base.log.perform('PRJ-001', U.alice, { action: 'propose' });
      base.log.store.notifications.splice(1);
      ctx = { ...base, dispatcher: new NotificationDispatcher(base.log, notifier) };
    });

    describe('WHEN the dispatcher first runs', () => {
      let stats: Awaited<ReturnType<NotificationDispatcher['run']>>;
      beforeEach(async () => { stats = await ctx.dispatcher.run(); });

      it('THEN the delivery is retrying', () => {
        expect(stats.retrying).toBe(1);
      });
    });

    describe('WHEN two minutes pass after the first failure and the dispatcher runs', () => {
      let stats: Awaited<ReturnType<NotificationDispatcher['run']>>;
      beforeEach(async () => {
        await ctx.dispatcher.run();
        ctx.clock.advanceMinutes(2);
        stats = await ctx.dispatcher.run();
      });

      it('THEN the email is sent and the row is marked sent', () => {
        expect(stats.sent).toBe(1);
        expect(ctx.log.store.channel_deliveries[0].status).toBe('sent');
      });
    });
  });
});
