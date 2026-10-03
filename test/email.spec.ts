import { describe, it, expect } from 'bun:test';
import {
  buildMimeMessage, formatAddress, parseAddress, dotStuff, encodeWord,
  SmtpTransport, SmtpError, parseSmtpUrl,
  EmailChannel, MemoryMailTransport,
  NotificationManager, checkChannelConformance, createNotificationPayload,
  dialLocal, setup, proposed, U,
} from './support/index.js';
import { startMockSmtp, makeCert } from './support/mock-smtp.js';

// ---------------------------------------------------------------- helpers
function parseMime(raw: string) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body: rest.join('\r\n\r\n') };
}
const decodeWords = (s: string) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
function parts(raw: string) {
  const { headers, body } = parseMime(raw);
  const boundary = /boundary="?([^";]+)"?/.exec(headers['content-type'])?.[1];
  const chunks = boundary ? body.split(`--${boundary}`).slice(1, -1) : [raw];
  return chunks.map((c) => {
    const p = parseMime(c.replace(/^\r\n/, ''));
    return { type: p.headers['content-type'], text: Buffer.from(p.body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
  });
}
const BASE = { from: 'Decision Log <noreply@example.com>', to: ['bob@acme.com'], subject: 'Hello', text: 'Plain body' };
const MSG = { from: 'Decision Log <noreply@example.com>', to: ['bob@acme.com'], subject: 'Hi', text: 'Body text' };
const smtp = (server: { port: number }, extra: Record<string, any> = {}) =>
  new SmtpTransport({ host: '127.0.0.1', port: server.port, timeoutMs: 2000, name: 'client.test', ...extra });

const cert = await makeCert();
const needsCert = !cert;

// ---------------------------------------------------------------- MIME
describe('MIME: multipart/alternative with base64 UTF-8 parts and required headers', () => {
  const build = () => buildMimeMessage({ ...BASE, html: '<p>Rich ✓</p>', text: 'Plain ✓ body', messageId: '<id1@example.com>', date: new Date('2024-03-20T10:00:00Z') });

  describe('GIVEN text, html, id and date', () => {
    describe('WHEN the message is built', () => {
      it('THEN the standard headers are present', () => {
        // Given / When
        const { headers } = parseMime(build());
        // Then
        expect(headers['mime-version']).toBe('1.0');
        expect(headers['content-type']).toMatch(/^multipart\/alternative; boundary=/);
        expect(headers['message-id']).toBe('<id1@example.com>');
        expect(headers.date).toBe('Wed, 20 Mar 2024 10:00:00 +0000');
        expect(headers.from).toBe('Decision Log <noreply@example.com>');
        expect(headers.to).toBe('bob@acme.com');
        expect(headers.subject).toBe('Hello');
      });
    });
  });

  describe('GIVEN text and html', () => {
    describe('WHEN the message is built', () => {
      it('THEN it has base64 UTF-8 text/plain and text/html parts that decode back', () => {
        const [text, html] = parts(build());
        expect(text.type).toMatch(/^text\/plain; charset=utf-8/);
        expect(text.text).toBe('Plain ✓ body');
        expect(html.type).toMatch(/^text\/html; charset=utf-8/);
        expect(html.text).toBe('<p>Rich ✓</p>');
      });
    });
  });

  describe('GIVEN a built message', () => {
    describe('WHEN its lines are measured', () => {
      it('THEN none exceed 998 and base64 lines are at most 76', () => {
        const raw = build();
        for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
        expect(raw.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l)).every((l) => l.length <= 76)).toBe(true);
      });
    });
    describe('WHEN its line endings are inspected', () => {
      it('THEN they are CRLF only', () => {
        const raw = build();
        expect(raw.includes('\n') && !raw.replace(/\r\n/g, '').includes('\n')).toBe(true);
      });
    });
  });
});

describe('MIME: text-only messages are a single part; non-ASCII subjects use encoded words', () => {
  describe('GIVEN no html', () => {
    describe('WHEN the message is built', () => {
      it('THEN it is a single text/plain part', () => {
        const { headers } = parseMime(buildMimeMessage({ ...BASE, subject: 'Entscheidung genehmigt ✓ — Übersicht' }));
        expect(headers['content-type']).toMatch(/^text\/plain; charset=utf-8/);
      });
    });
  });

  describe('GIVEN a non-ASCII subject', () => {
    describe('WHEN the message is built', () => {
      it('THEN the subject is an encoded word that decodes back', () => {
        const { headers } = parseMime(buildMimeMessage({ ...BASE, subject: 'Entscheidung genehmigt ✓ — Übersicht' }));
        expect(headers.subject).toMatch(/^=\?UTF-8\?B\?/);
        expect(decodeWords(headers.subject)).toBe('Entscheidung genehmigt ✓ — Übersicht');
      });
    });
  });

  describe('GIVEN a 200-character value', () => {
    describe('WHEN encoded', () => {
      it('THEN it splits into several words that decode back to the original', () => {
        expect(decodeWords(encodeWord('x'.repeat(200)))).toBe('x'.repeat(200));
      });
    });
  });

  describe('GIVEN a long multibyte value', () => {
    describe('WHEN encoded', () => {
      it('THEN every encoded word is at most 75 characters', () => {
        for (const w of encodeWord('ü'.repeat(100)).split(' ')) expect(w.length).toBeLessThanOrEqual(75);
      });
    });
  });
});

describe('MIME: addresses are parsed, quoted and encoded safely', () => {
  describe('GIVEN a display name and address', () => {
    describe('WHEN parsed', () => {
      it('THEN name and address are separated', () => {
        expect(parseAddress('Decision Log <noreply@example.com>')).toEqual({ name: 'Decision Log', address: 'noreply@example.com' });
      });
    });
  });

  describe('GIVEN a bare address', () => {
    describe('WHEN parsed', () => {
      it('THEN the name is null', () => {
        expect(parseAddress('noreply@example.com')).toEqual({ name: null, address: 'noreply@example.com' });
      });
    });
  });

  describe('GIVEN a quoted name containing a comma', () => {
    describe('WHEN parsed', () => {
      it('THEN the comma stays in the name', () => {
        expect(parseAddress('"Doe, Jane" <jane@example.com>')).toEqual({ name: 'Doe, Jane', address: 'jane@example.com' });
      });
    });
  });

  describe('GIVEN a name with a comma', () => {
    describe('WHEN formatted', () => {
      it('THEN it is quoted', () => {
        expect(formatAddress({ name: 'Doe, Jane', address: 'jane@example.com' })).toBe('"Doe, Jane" <jane@example.com>');
      });
    });
  });

  describe('GIVEN a name with quotes', () => {
    describe('WHEN formatted', () => {
      it('THEN the quotes are escaped', () => {
        expect(formatAddress({ name: 'Say "hi"', address: 'a@b.co' })).toBe('"Say \\"hi\\"" <a@b.co>');
      });
    });
  });

  describe('GIVEN a non-ASCII name', () => {
    describe('WHEN formatted', () => {
      it('THEN it becomes an encoded word', () => {
        expect(formatAddress({ name: 'Jürgen', address: 'j@b.co' })).toMatch(/^=\?UTF-8\?B\?.+\?= <j@b\.co>$/);
      });
    });
  });

  for (const bad of ['', 'nobody', 'a@b', 'a b@c.de', '<>', 'Name <a@b.co> extra']) {
    describe(`GIVEN the invalid address ${JSON.stringify(bad)}`, () => {
      describe(`WHEN parsed`, () => {
        it(`THEN it is rejected`, () => {
          expect(() => parseAddress(bad)).toThrow(/address/i);
        });
      });
    });
  }
});

describe('MIME: header injection is impossible', () => {
  const evil = 'x\r\nBcc: attacker@evil.example';

  describe('GIVEN a subject with a newline', () => {
    describe('WHEN built', () => {
      it('THEN it is rejected', () => {
        expect(() => buildMimeMessage({ ...BASE, subject: evil })).toThrow(/newline|control/i);
      });
    });
  });

  describe('GIVEN a From with an injected header', () => {
    describe('WHEN built', () => {
      it('THEN it is rejected', () => {
        expect(() => buildMimeMessage({ ...BASE, from: `Mallory${'\r\n'}Bcc: a@b.co <m@x.io>` })).toThrow(/address|newline|control/i);
      });
    });
  });

  describe('GIVEN a recipient with an injected header', () => {
    describe('WHEN built', () => {
      it('THEN it is rejected', () => {
        expect(() => buildMimeMessage({ ...BASE, to: ['a@b.co\nBcc: c@d.ef'] })).toThrow(/address/i);
      });
    });
  });

  describe('GIVEN a custom header value with a newline', () => {
    describe('WHEN built', () => {
      it('THEN it is rejected', () => {
        expect(() => buildMimeMessage({ ...BASE, headers: { 'X-Ok': evil } })).toThrow(/newline|control/i);
      });
    });
  });

  describe('GIVEN a custom header name with a newline', () => {
    describe('WHEN built', () => {
      it('THEN it is rejected', () => {
        expect(() => buildMimeMessage({ ...BASE, headers: { 'X-Bad\r\nBcc': 'v' } })).toThrow(/header name/i);
      });
    });
  });

  describe('GIVEN a Message-ID with a newline', () => {
    describe('WHEN built', () => {
      it('THEN it is rejected', () => {
        expect(() => buildMimeMessage({ ...BASE, messageId: '<a@b>\r\nBcc: x@y.z' })).toThrow(/newline|control|message-id/i);
      });
    });
  });

  describe('GIVEN no recipients', () => {
    describe('WHEN built', () => {
      it('THEN it is rejected', () => {
        expect(() => buildMimeMessage({ ...BASE, to: [] })).toThrow(/recipient/i);
      });
    });
  });

  describe('GIVEN body text that looks like a header', () => {
    describe('WHEN built', () => {
      it('THEN it cannot reach the header block', () => {
        const raw = buildMimeMessage({ ...BASE, text: 'line1\r\nBcc: not-a-header' });
        expect(raw.split('\r\n\r\n')[0].includes('Bcc')).toBe(false);
      });
    });
  });
});

describe('dotStuff doubles leading dots and normalises line endings', () => {
  describe('GIVEN lines starting with dots and mixed endings', () => {
    describe('WHEN dot-stuffed', () => {
      it('THEN dots are doubled and endings are CRLF', () => {
        expect(dotStuff('a\n.b\r\n..c\r\n.')).toBe('a\r\n..b\r\n...c\r\n..');
      });
    });
  });

  describe('GIVEN plain text', () => {
    describe('WHEN dot-stuffed', () => {
      it('THEN it is unchanged', () => {
        expect(dotStuff('plain')).toBe('plain');
      });
    });
  });
});

// ---------------------------------------------------------------- SMTP transport
describe('SMTP: a complete session delivers the message and reports acceptance', () => {
  async function delivered() {
    const server = await startMockSmtp();
    const res = await smtp(server).send({ ...MSG, to: ['bob@acme.com', 'carol@acme.com'], html: '<b>hi</b>', messageId: '<fixed@example.com>' });
    return { server, res };
  }

  describe('GIVEN two recipients', () => {
    describe('WHEN a message is sent', () => {
      it('THEN both are accepted and the Message-ID is returned', async () => {
        const { res } = await delivered();
        expect(res.accepted).toEqual(['bob@acme.com', 'carol@acme.com']);
        expect(res.rejected).toEqual([]);
        expect(res.id).toBe('<fixed@example.com>');
      });
    });
  });

  describe('GIVEN a send', () => {
    describe('WHEN the server transcript is read', () => {
      it('THEN the commands follow EHLO, MAIL, RCPT per recipient, DATA, QUIT', async () => {
        const { server } = await delivered();
        expect(server.sessions[0].commands).toEqual(['EHLO client.test', 'MAIL FROM:<noreply@example.com>', 'RCPT TO:<bob@acme.com>', 'RCPT TO:<carol@acme.com>', 'DATA', 'QUIT']);
      });
    });
    describe('WHEN the received message is parsed', () => {
      it('THEN subject, Message-ID and both parts match', async () => {
        const { server } = await delivered();
        const { headers } = parseMime(server.sessions[0].message);
        expect(headers.subject).toBe('Hi');
        expect(headers['message-id']).toBe('<fixed@example.com>');
        expect(parts(server.sessions[0].message).map((p) => p.text)).toEqual(['Body text', '<b>hi</b>']);
      });
    });
  });
});

describe('SMTP: AUTH PLAIN, with AUTH LOGIN as fallback; bad credentials are reported', () => {
  describe('GIVEN a server offering PLAIN', () => {
    describe('WHEN sending with credentials', () => {
      it('THEN the server authenticates the user', async () => {
        const plain = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
        await smtp(plain, { auth: { user: 'u', pass: 'p' } }).send(MSG);
        expect(plain.sessions[0].authUser).toBe('u');
      });
    });
  });

  describe('GIVEN a server offering only LOGIN', () => {
    describe('WHEN sending with credentials', () => {
      it('THEN it falls back to AUTH LOGIN', async () => {
        const login = await startMockSmtp({ auth: { user: 'u', pass: 'p', mechs: ['LOGIN'] } });
        await smtp(login, { auth: { user: 'u', pass: 'p' } }).send(MSG);
        expect(login.sessions[0].authUser).toBe('u');
      });
    });
  });

  describe('GIVEN a wrong password', () => {
    describe('WHEN sending', () => {
      it('THEN it fails with SmtpError 535 marked retryable', async () => {
        const plain = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
        await expect(smtp(plain, { auth: { user: 'u', pass: 'wrong' } }).send(MSG)).rejects.toMatchObject({ code: 535, retryable: true });
      });

      it('THEN the error is an SmtpError', async () => {
        const plain = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
        const err = await smtp(plain, { auth: { user: 'u', pass: 'wrong' } }).send(MSG).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SmtpError);
      });
    });
  });
});

describe('SMTP: credentials are never sent over an unencrypted non-loopback connection', () => {
  const remote = (server: { port: number }, extra: Record<string, any> = {}) =>
    new SmtpTransport({ host: 'mail.example.com', port: 25, dial: () => dialLocal(server.port), auth: { user: 'u', pass: 'p' }, timeoutMs: 2000, ...extra });

  describe('GIVEN a remote host without TLS', () => {
    describe('WHEN sending with credentials', () => {
      it('THEN it refuses as unencrypted and not retryable', async () => {
        const server = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
        const err: any = await remote(server).send(MSG).catch((e: unknown) => e);
        expect(err.message).toMatch(/unencrypted/i);
        expect(err.retryable).toBe(false);
      });
    });
  });

  describe('GIVEN a refused send', () => {
    describe('WHEN the server transcript is read', () => {
      it('THEN no AUTH command was ever sent', async () => {
        const server = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
        await remote(server).send(MSG).catch(() => {});
        expect(server.sessions[0].authUser).toBe(null);
        expect(server.sessions[0].commands.some((c: string) => c.startsWith('AUTH'))).toBe(false);
      });
    });
  });

  describe('GIVEN allowInsecureAuth is set', () => {
    describe('WHEN sending to the same remote host', () => {
      it('THEN the credentials are used (explicit opt-in)', async () => {
        const server = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
        await remote(server, { allowInsecureAuth: true }).send(MSG);
        expect(server.sessions[0].authUser).toBe('u');
      });
    });
  });
});

describe('SMTP: STARTTLS upgrades the connection before authenticating', () => {
  async function upgraded() {
    const server = await startMockSmtp({ tlsOptions: cert, auth: { user: 'u', pass: 'p' } });
    const t = new SmtpTransport({ host: 'mail.example.com', port: 587, dial: () => dialLocal(server.port), starttls: 'required', tls: { rejectUnauthorized: false }, auth: { user: 'u', pass: 'p' }, timeoutMs: 3000, name: 'c.test' });
    await t.send(MSG);
    return server.sessions[0];
  }

  describe('GIVEN a server offering STARTTLS', () => {
    describe('WHEN sending with starttls required', () => {
      it.skipIf(needsCert)('THEN the session is encrypted and EHLO is repeated', async () => {
        const s = await upgraded();
        expect(s.tls).toBe(true);
        expect(s.ehloCount).toBe(2);
      });
    });
  });

  describe('GIVEN an upgraded session', () => {
    describe('WHEN the transcript is read', () => {
      it.skipIf(needsCert)('THEN STARTTLS precedes AUTH and the user authenticated', async () => {
        const s = await upgraded();
        expect(s.authUser).toBe('u');
        expect(s.commands.indexOf('STARTTLS')).toBeLessThan(s.commands.findIndex((c: string) => c.startsWith('AUTH')));
      });
    });
    describe('WHEN the message is read', () => {
      it.skipIf(needsCert)('THEN it arrived intact', async () => {
        const s = await upgraded();
        expect(s.message).toMatch(/Subject: Hi/);
      });
    });
  });
});

describe('SMTP: certificates are verified by default', () => {
  describe('GIVEN a self-signed server', () => {
    describe('WHEN sending with starttls required and default TLS options', () => {
      it.skipIf(needsCert)('THEN an SmtpError reports the certificate failure', async () => {
        const server = await startMockSmtp({ tlsOptions: cert });
        const t = new SmtpTransport({ host: 'localhost', port: 587, dial: () => dialLocal(server.port), starttls: 'required', timeoutMs: 3000 });
        const err: any = await t.send(MSG).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SmtpError);
        expect(err.message).toMatch(/self.signed|certificate|verify/i);
      });
    });
  });
});

describe('SMTP: implicit TLS (smtps)', () => {
  describe('GIVEN a TLS-on-connect server', () => {
    describe('WHEN sending with secure=true', () => {
      it.skipIf(needsCert)('THEN the session is encrypted and the message arrives', async () => {
        const server = await startMockSmtp({ tlsOptions: cert, implicitTls: true });
        await new SmtpTransport({ host: '127.0.0.1', port: server.port, secure: true, tls: { rejectUnauthorized: false }, timeoutMs: 3000 }).send(MSG);
        expect(server.sessions[0].tls).toBe(true);
        expect(server.sessions[0].message).toMatch(/Subject: Hi/);
      });
    });
  });
});

describe('SMTP: STARTTLS policy — required fails closed, auto continues in plaintext, never ignores the offer', () => {
  describe('GIVEN a server without STARTTLS', () => {
    describe('WHEN sending with starttls required', () => {
      it('THEN it fails mentioning STARTTLS and is retryable', async () => {
        const noTls = await startMockSmtp();
        const err: any = await smtp(noTls, { starttls: 'required' }).send(MSG).catch((e: unknown) => e);
        expect(err.message).toMatch(/STARTTLS/);
        expect(err.retryable).toBe(true);
      });
    });
    describe('WHEN sending with starttls auto', () => {
      it('THEN it continues in plaintext', async () => {
        const noTls = await startMockSmtp();
        await smtp(noTls, { starttls: 'auto' }).send(MSG);
        expect(noTls.sessions.at(-1).tls).toBe(false);
      });
    });
  });

  describe('GIVEN a server offering STARTTLS', () => {
    describe('WHEN sending with starttls never', () => {
      it.skipIf(needsCert)('THEN STARTTLS is not issued', async () => {
        const offers = await startMockSmtp({ tlsOptions: cert });
        await smtp(offers, { starttls: 'never' }).send(MSG);
        expect(offers.sessions[0].commands.includes('STARTTLS')).toBe(false);
      });
    });
  });
});

describe('SMTP: recipient outcomes — partial acceptance succeeds, total rejection is classified by reply class', () => {
  const gone = { 'gone@acme.com': '550 5.1.1 no such user' };

  describe('GIVEN one good and one unknown recipient', () => {
    describe('WHEN sending', () => {
      it('THEN it succeeds with the rejection detailed', async () => {
        const partial = await startMockSmtp({ rcpt: gone });
        const res = await smtp(partial).send({ ...MSG, to: ['bob@acme.com', 'gone@acme.com'] });
        expect(res.accepted).toEqual(['bob@acme.com']);
        expect(res.rejected).toEqual([{ address: 'gone@acme.com', code: 550, response: '5.1.1 no such user' }]);
      });
    });
  });

  describe('GIVEN only an unknown recipient', () => {
    describe('WHEN sending', () => {
      it('THEN it fails with 550 and is not retryable', async () => {
        const permanent = await startMockSmtp({ rcpt: gone });
        await expect(smtp(permanent).send({ ...MSG, to: ['gone@acme.com'] })).rejects.toMatchObject({ code: 550, retryable: false });
      });
    });
  });

  describe('GIVEN only a recipient with a 450 reply', () => {
    describe('WHEN sending', () => {
      it('THEN it fails with 450 and is retryable', async () => {
        const temporary = await startMockSmtp({ rcpt: { 'busy@acme.com': '450 4.2.0 mailbox busy' } });
        await expect(smtp(temporary).send({ ...MSG, to: ['busy@acme.com'] })).rejects.toMatchObject({ code: 450, retryable: true });
      });
    });
  });

  describe('GIVEN a failed send', () => {
    describe('WHEN the transcript is read', () => {
      it('THEN the client still closed politely with QUIT', async () => {
        const permanent = await startMockSmtp({ rcpt: gone });
        await smtp(permanent).send({ ...MSG, to: ['gone@acme.com'] }).catch(() => {});
        expect(permanent.sessions[0].commands.includes('QUIT')).toBe(true);
      });
    });
  });
});

describe('SMTP: DATA and MAIL rejections are classified', () => {
  describe('GIVEN a server rejecting DATA with 554', () => {
    describe('WHEN sending', () => {
      it('THEN it fails with 554, not retryable', async () => {
        const server = await startMockSmtp({ data: '554 5.7.1 message rejected as spam' });
        await expect(smtp(server).send(MSG)).rejects.toMatchObject({ code: 554, retryable: false });
      });
    });
  });

  describe('GIVEN a server deferring DATA with 451', () => {
    describe('WHEN sending', () => {
      it('THEN it fails with 451, retryable', async () => {
        const server = await startMockSmtp({ data: '451 4.3.0 try again later' });
        await expect(smtp(server).send(MSG)).rejects.toMatchObject({ code: 451, retryable: true });
      });
    });
  });

  describe('GIVEN a server rejecting MAIL FROM with 553', () => {
    describe('WHEN sending', () => {
      it('THEN it fails with 553, not retryable', async () => {
        const server = await startMockSmtp({ mail: '553 5.7.1 sender not allowed' });
        await expect(smtp(server).send(MSG)).rejects.toMatchObject({ code: 553, retryable: false });
      });
    });
  });
});

describe('SMTP: network failures and timeouts are retryable', () => {
  describe('GIVEN nothing listening on the port', () => {
    describe('WHEN sending', () => {
      it('THEN an SmtpError marked retryable', async () => {
        const closed = await startMockSmtp();
        const port = closed.port;
        await closed.close();
        const err: any = await new SmtpTransport({ host: '127.0.0.1', port, timeoutMs: 500 }).send(MSG).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SmtpError);
        expect(err.retryable).toBe(true);
      });
    });
  });

  describe('GIVEN a server that never greets', () => {
    describe('WHEN sending with a 150ms timeout', () => {
      it('THEN it times out, retryable', async () => {
        const silent = await startMockSmtp({ silent: true });
        const err: any = await smtp(silent, { timeoutMs: 150 }).send(MSG).catch((e: unknown) => e);
        expect(err.message).toMatch(/timed out/i);
        expect(err.retryable).toBe(true);
      });
    });
  });

  describe('GIVEN a server greeting 554', () => {
    describe('WHEN sending', () => {
      it('THEN it fails with 554, not retryable', async () => {
        const bad = await startMockSmtp({ greeting: '554 no service' });
        await expect(smtp(bad).send(MSG)).rejects.toMatchObject({ code: 554, retryable: false });
      });
    });
  });
});

describe('SMTP: unsafe envelopes are rejected before any connection is made', () => {
  describe('GIVEN a recipient that smuggles an SMTP command', () => {
    describe('WHEN sending', () => {
      it('THEN the address is rejected', async () => {
        const server = await startMockSmtp();
        await expect(smtp(server).send({ ...MSG, to: ['a@b.co>\r\nRCPT TO:<evil@x.io'] })).rejects.toThrow(/address/i);
      });
    });
  });

  describe('GIVEN a sender that smuggles an SMTP command', () => {
    describe('WHEN sending', () => {
      it('THEN it is rejected', async () => {
        const server = await startMockSmtp();
        await expect(smtp(server).send({ ...MSG, from: 'x@y.zz\r\nDATA' })).rejects.toThrow(/address|newline|control/i);
      });
    });
  });

  describe('GIVEN no recipients', () => {
    describe('WHEN sending', () => {
      it('THEN it is rejected', async () => {
        const server = await startMockSmtp();
        await expect(smtp(server).send({ ...MSG, to: [] })).rejects.toThrow(/recipient/i);
      });
    });
  });

  describe('GIVEN rejected envelopes', () => {
    describe('WHEN the server is inspected', () => {
      it('THEN no connection was ever made', async () => {
        const server = await startMockSmtp();
        await smtp(server).send({ ...MSG, to: [] }).catch(() => {});
        expect(server.sessions.length).toBe(0);
      });
    });
  });
});

describe('parseSmtpUrl understands smtp://, smtps:// and options', () => {
  describe('GIVEN an smtp URL with encoded credentials, port and starttls', () => {
    describe('WHEN parsed', () => {
      it('THEN every part is decoded', () => {
        expect(parseSmtpUrl('smtp://us%40er:p%3Ass@mail.example.com:2525?starttls=required')).toEqual({
          host: 'mail.example.com', port: 2525, secure: false, starttls: 'required', auth: { user: 'us@er', pass: 'p:ss' },
        });
      });
    });
  });

  describe('GIVEN an smtps URL', () => {
    describe('WHEN parsed', () => {
      it('THEN it is secure on 465 with auto starttls and no auth', () => {
        expect(parseSmtpUrl('smtps://mail.example.com')).toEqual({ host: 'mail.example.com', port: 465, secure: true, starttls: 'auto', auth: null });
      });
    });
  });

  describe('GIVEN an smtp URL without a port', () => {
    describe('WHEN parsed', () => {
      it('THEN the port is 587', () => {
        expect(parseSmtpUrl('smtp://mail.example.com').port).toBe(587);
      });
    });
  });

  describe('GIVEN an http URL', () => {
    describe('WHEN parsed', () => {
      it('THEN it is rejected as not smtp', () => {
        expect(() => parseSmtpUrl('http://mail.example.com')).toThrow(/smtp/i);
      });
    });
  });

  describe('GIVEN a URL without a host', () => {
    describe('WHEN parsed', () => {
      it('THEN it is rejected', () => {
        expect(() => parseSmtpUrl('smtp://')).toThrow(/host/i);
      });
    });
  });

  describe('GIVEN an unknown starttls option', () => {
    describe('WHEN parsed', () => {
      it('THEN it is rejected', () => {
        expect(() => parseSmtpUrl('smtp://h?starttls=maybe')).toThrow(/starttls/i);
      });
    });
  });
});

// ---------------------------------------------------------------- EmailChannel
const payload = () => createNotificationPayload({
  id: 'notif-007', type: 'decision_proposed', priority: 'high',
  recipient: { user: U.bob, email: U.bob },
  content: { title: '[PRJ-001] Decision <b>proposed</b>', body: 'Alice proposed "Use Postgres" & more.\nSecond line.', link: 'https://dl.example.com/#/d/PRJ-001' },
  context: { decision_id: 'PRJ-001', project: 'PRJ' },
});
const noEmail = () => createNotificationPayload({ ...payload(), recipient: { user: 'x' } });
const FROM = 'Decision Log <noreply@example.com>';

describe('EmailChannel satisfies the channel contract', () => {
  const channel = () => new EmailChannel({ transport: new MemoryMailTransport(), from: FROM });

  describe('GIVEN an email channel', () => {
    describe('WHEN its name is read', () => {
      it('THEN it is email', () => {
        expect(channel().name).toBe('email');
      });
    });
    describe('WHEN checked with the conformance kit', () => {
      it('THEN there are no problems', async () => {
        expect(await checkChannelConformance(channel(), { payload: payload(), unaddressable: noEmail() })).toEqual([]);
      });
    });
    describe('WHEN supports is asked', () => {
      it('THEN only payloads with an email address are supported', () => {
        expect(channel().supports(payload())).toBe(true);
        expect(channel().supports(noEmail())).toBe(false);
      });
    });
  });

  describe('GIVEN no from', () => {
    describe('WHEN the channel is built', () => {
      it('THEN it demands from', () => {
        expect(() => new EmailChannel({ transport: new MemoryMailTransport() } as any)).toThrow(/from/);
      });
    });
  });

  describe('GIVEN no transport', () => {
    describe('WHEN the channel is built', () => {
      it('THEN it demands transport', () => {
        expect(() => new EmailChannel({ from: 'a@b.co' } as any)).toThrow(/transport/);
      });
    });
  });

  describe('GIVEN a transport without send', () => {
    describe('WHEN the channel is built', () => {
      it('THEN it demands a valid transport', () => {
        expect(() => new EmailChannel({ transport: {} as any, from: 'a@b.co' })).toThrow(/transport/);
      });
    });
  });

  describe('GIVEN an invalid from address', () => {
    describe('WHEN the channel is built', () => {
      it('THEN it is rejected', () => {
        expect(() => new EmailChannel({ transport: new MemoryMailTransport(), from: 'not an address' })).toThrow(/address/i);
      });
    });
  });
});

describe('EmailChannel renders safe text and HTML with stable identifiers', () => {
  async function sentOnce() {
    const transport = new MemoryMailTransport();
    const ch = new EmailChannel({ transport, from: FROM, replyTo: 'help@example.com', appName: 'Decision Log' });
    const result = await ch.send(payload());
    return { transport, ch, result, m: transport.sent[0] };
  }

  describe('GIVEN a payload', () => {
    describe('WHEN sent', () => {
      it('THEN the result is sent with a deterministic provider id', async () => {
        const { result } = await sentOnce();
        expect(result).toEqual({ status: 'sent', provider_id: '<notif-007.email@example.com>' });
      });

      it('THEN envelope fields come from the payload and options', async () => {
        const { m } = await sentOnce();
        expect(m.to).toEqual(['bob@acme.com']);
        expect(m.from).toBe(FROM);
        expect(m.replyTo).toBe('help@example.com');
        expect(m.subject).toBe('[PRJ-001] Decision <b>proposed</b>');
      });

      it('THEN the text part carries the body and the link', async () => {
        const { m } = await sentOnce();
        expect(m.text).toMatch(/Alice proposed "Use Postgres" & more\.\nSecond line\./);
        expect(m.text).toMatch(/https:\/\/dl\.example\.com\/#\/d\/PRJ-001/);
      });
    });
  });

  describe('GIVEN a title containing markup', () => {
    describe('WHEN sent', () => {
      it('THEN the HTML part escapes it and still links and keeps line text', async () => {
        const { m } = await sentOnce();
        expect(m.html.includes('<b>proposed</b>')).toBe(false);
        expect(m.html).toMatch(/&lt;b&gt;proposed&lt;\/b&gt;/);
        expect(m.html).toMatch(/&amp; more/);
        expect(m.html).toMatch(/<a href="https:\/\/dl\.example\.com\/#\/d\/PRJ-001"/);
        expect(m.html).toMatch(/Second line/);
      });
    });
  });

  describe('GIVEN a payload', () => {
    describe('WHEN sent', () => {
      it('THEN the message carries stable id and notification headers', async () => {
        const { m } = await sentOnce();
        expect(m.messageId).toBe('<notif-007.email@example.com>');
        expect(m.headers['Auto-Submitted']).toBe('auto-generated');
        expect(m.headers['X-Decision-Log-Notification']).toBe('notif-007');
        expect(m.headers['X-Decision-Log-Type']).toBe('decision_proposed');
        expect(m.headers.Importance).toBe('high');
      });
    });
  });

  describe('GIVEN a payload already sent', () => {
    describe('WHEN it is sent again (a retry)', () => {
      it('THEN the Message-ID is reused for de-duplication', async () => {
        const { transport, ch, m } = await sentOnce();
        await ch.send(payload());
        expect(transport.sent[1].messageId).toBe(m.messageId);
      });
    });
  });
});

describe('EmailChannel sanitises subjects and trusts caller HTML only when supplied', () => {
  describe('GIVEN a title with CRLF and a Bcc header', () => {
    describe('WHEN sent', () => {
      it('THEN the subject is flattened to one line', async () => {
        const transport = new MemoryMailTransport();
        await new EmailChannel({ transport, from: 'noreply@example.com' })
          .send(createNotificationPayload({ ...payload(), content: { ...payload().content, title: 'Line one\r\nBcc: x@y.zz' } }));
        expect(transport.sent[0].subject).toBe('Line one Bcc: x@y.zz');
      });
    });
  });

  describe('GIVEN a payload with caller-supplied HTML', () => {
    describe('WHEN sent', () => {
      it('THEN that HTML is used as-is', async () => {
        const transport = new MemoryMailTransport();
        await new EmailChannel({ transport, from: 'noreply@example.com' })
          .send(createNotificationPayload({ ...payload(), id: 'n2', content: { ...payload().content, html: '<h1>Custom</h1>' } }));
        expect(transport.sent[0].html).toBe('<h1>Custom</h1>');
      });
    });
  });
});

describe('EmailChannel maps transport errors onto retryable/permanent results', () => {
  const channelFailing = (err: Error) => new EmailChannel({ from: 'noreply@example.com', transport: { async send() { throw err; } } as any });

  describe('GIVEN a retryable transport error', () => {
    describe('WHEN sent', () => {
      it('THEN the result is failed and retryable', async () => {
        const retry = Object.assign(new Error('451 try later'), { retryable: true });
        expect(await channelFailing(retry).send(payload())).toEqual({ status: 'failed', error: '451 try later', retryable: true });
      });
    });
  });

  describe('GIVEN a permanent transport error', () => {
    describe('WHEN sent', () => {
      it('THEN the result is failed and not retryable', async () => {
        const perm = Object.assign(new Error('550 no such user'), { retryable: false });
        expect(await channelFailing(perm).send(payload())).toEqual({ status: 'failed', error: '550 no such user', retryable: false });
      });
    });
  });

  describe('GIVEN an error with no retryable flag', () => {
    describe('WHEN sent', () => {
      it('THEN it defaults to retryable', async () => {
        expect((await channelFailing(new Error('weird')).send(payload())).retryable).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------- end to end: manager -> EmailChannel -> SMTP
describe('end to end: team members receive real emails over SMTP, and transient failures are retried', () => {
  async function ran() {
    const server = await startMockSmtp({ rcpt: { 'carol@acme.com': '451 4.2.1 greylisted, try again' } });
    const { log } = await setup();
    const manager = new NotificationManager(log, { appUrl: 'https://dl.example.com' });
    manager.register(new EmailChannel({ transport: smtp(server), from: FROM }));
    const id = proposed(log);
    const stats = await manager.run();
    return { server, id, stats, mails: server.sessions.filter((s: any) => s.message) };
  }

  describe('GIVEN carol is greylisted', () => {
    describe('WHEN the manager runs', () => {
      it('THEN three emails are sent and one is retrying', async () => {
        const { stats } = await ran();
        expect(stats.sent).toBe(3);
        expect(stats.retrying).toBe(1);
      });

      it('THEN bob, david and the lead receive mail', async () => {
        const { mails } = await ran();
        expect(mails.map((s: any) => s.rcpts[0]).sort()).toEqual(['bob@acme.com', 'david@acme.com', 'lead@acme.com']);
      });
    });
  });

  describe('GIVEN bob received his email', () => {
    describe('WHEN it is parsed', () => {
      it('THEN the subject names the decision and the text links to it', async () => {
        const { id, mails } = await ran();
        const bob = mails.find((s: any) => s.rcpts[0] === 'bob@acme.com');
        expect(decodeWords(parseMime(bob.message).headers.subject)).toBe(`[${id}] Decision proposed for review`);
        expect(parts(bob.message)[0].text.includes(`https://dl.example.com/#/d/${id}`)).toBe(true);
      });
    });
  });
});

describe('end to end retry: the greylisted recipient succeeds on the next attempt', () => {
  async function greylisted() {
    let attempts = 0;
    const flaky = {
      async send(message: any) {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('451 greylisted'), { retryable: true });
        return { id: message.messageId, accepted: message.to, rejected: [] };
      },
    };
    const { log, clock } = await setup();
    const manager = new NotificationManager(log);
    manager.register(new EmailChannel({ transport: flaky as any, from: 'noreply@example.com' }));
    log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
    log.perform('PRJ-001', U.alice, { action: 'propose' });
    log.store.notifications.splice(1);
    return { log, clock, manager };
  }

  describe('GIVEN a transport that fails once', () => {
    describe('WHEN the manager first runs', () => {
      it('THEN the delivery is retrying', async () => {
        const { manager } = await greylisted();
        expect((await manager.run()).retrying).toBe(1);
      });
    });
  });

  describe('GIVEN a first failure', () => {
    describe('WHEN two minutes pass and the manager runs', () => {
      it('THEN the email is sent and the row is marked sent', async () => {
        const { log, clock, manager } = await greylisted();
        await manager.run();
        clock.advanceMinutes(2);
        expect((await manager.run()).sent).toBe(1);
        expect(log.store.channel_deliveries[0].status).toBe('sent');
      });
    });
  });
});
