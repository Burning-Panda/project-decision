import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { buildMimeMessage, formatAddress, parseAddress, dotStuff, encodeWord } from '../src/notifications/mime.js';
import { SmtpTransport, SmtpError, parseSmtpUrl } from '../src/notifications/smtp.js';
import { EmailChannel, MemoryMailTransport } from '../src/notifications/email.js';
import { NotificationManager, checkChannelConformance, createNotificationPayload } from '../src/notifications/index.js';
import { startMockSmtp, makeCert } from './mock-smtp.js';
import { setup, proposed, U } from './helpers.js';

// ---------------------------------------------------------------- helpers
function parseMime(raw) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const headers = {};
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body: rest.join('\r\n\r\n') };
}
const decodeWords = (s) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
function parts(raw) {
  const { headers, body } = parseMime(raw);
  const boundary = /boundary="?([^";]+)"?/.exec(headers['content-type'])?.[1];
  const chunks = boundary ? body.split(`--${boundary}`).slice(1, -1) : [raw];
  return chunks.map((c) => {
    const p = parseMime(c.replace(/^\r\n/, ''));
    return { type: p.headers['content-type'], text: Buffer.from(p.body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
  });
}
const BASE = { from: 'Decision Log <noreply@example.com>', to: ['bob@acme.com'], subject: 'Hello', text: 'Plain body' };

// ---------------------------------------------------------------- MIME
test('MIME: multipart/alternative with base64 UTF-8 parts and required headers', () => {
  const raw = buildMimeMessage({ ...BASE, html: '<p>Rich ✓</p>', text: 'Plain ✓ body', messageId: '<id1@example.com>', date: new Date('2024-03-20T10:00:00Z') });
  const { headers } = parseMime(raw);
  assert.equal(headers['mime-version'], '1.0');
  assert.match(headers['content-type'], /^multipart\/alternative; boundary=/);
  assert.equal(headers['message-id'], '<id1@example.com>');
  assert.equal(headers.date, 'Wed, 20 Mar 2024 10:00:00 +0000');
  assert.equal(headers.from, 'Decision Log <noreply@example.com>');
  assert.equal(headers.to, 'bob@acme.com');
  assert.equal(headers.subject, 'Hello');
  const [text, html] = parts(raw);
  assert.match(text.type, /^text\/plain; charset=utf-8/);
  assert.equal(text.text, 'Plain ✓ body');
  assert.match(html.type, /^text\/html; charset=utf-8/);
  assert.equal(html.text, '<p>Rich ✓</p>');
  for (const line of raw.split('\r\n')) assert.ok(line.length <= 998);
  assert.ok(raw.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l)).every((l) => l.length <= 76));
  assert.equal(raw.includes('\n') && !raw.replace(/\r\n/g, '').includes('\n'), true, 'CRLF only');
});

test('MIME: text-only messages are a single part; non-ASCII subjects use encoded words', () => {
  const raw = buildMimeMessage({ ...BASE, subject: 'Entscheidung genehmigt ✓ — Übersicht' });
  const { headers } = parseMime(raw);
  assert.match(headers['content-type'], /^text\/plain; charset=utf-8/);
  assert.match(headers.subject, /^=\?UTF-8\?B\?/);
  assert.equal(decodeWords(headers.subject), 'Entscheidung genehmigt ✓ — Übersicht');
  assert.equal(decodeWords(encodeWord('x'.repeat(200))), 'x'.repeat(200), 'long values split into several words');
  for (const w of encodeWord('ü'.repeat(100)).split(' ')) assert.ok(w.length <= 75);
});

test('MIME: addresses are parsed, quoted and encoded safely', () => {
  assert.deepEqual(parseAddress('Decision Log <noreply@example.com>'), { name: 'Decision Log', address: 'noreply@example.com' });
  assert.deepEqual(parseAddress('noreply@example.com'), { name: null, address: 'noreply@example.com' });
  assert.deepEqual(parseAddress('"Doe, Jane" <jane@example.com>'), { name: 'Doe, Jane', address: 'jane@example.com' });
  assert.equal(formatAddress({ name: 'Doe, Jane', address: 'jane@example.com' }), '"Doe, Jane" <jane@example.com>');
  assert.equal(formatAddress({ name: 'Say "hi"', address: 'a@b.co' }), '"Say \\"hi\\"" <a@b.co>');
  assert.match(formatAddress({ name: 'Jürgen', address: 'j@b.co' }), /^=\?UTF-8\?B\?.+\?= <j@b\.co>$/);
  for (const bad of ['', 'nobody', 'a@b', 'a b@c.de', '<>', 'Name <a@b.co> extra']) assert.throws(() => parseAddress(bad), /address/i);
});

test('MIME: header injection is impossible', () => {
  const evil = 'x\r\nBcc: attacker@evil.example';
  assert.throws(() => buildMimeMessage({ ...BASE, subject: evil }), /newline|control/i);
  assert.throws(() => buildMimeMessage({ ...BASE, from: `Mallory${'\r\n'}Bcc: a@b.co <m@x.io>` }), /address|newline|control/i);
  assert.throws(() => buildMimeMessage({ ...BASE, to: ['a@b.co\nBcc: c@d.ef'] }), /address/i);
  assert.throws(() => buildMimeMessage({ ...BASE, headers: { 'X-Ok': evil } }), /newline|control/i);
  assert.throws(() => buildMimeMessage({ ...BASE, headers: { 'X-Bad\r\nBcc': 'v' } }), /header name/i);
  assert.throws(() => buildMimeMessage({ ...BASE, messageId: '<a@b>\r\nBcc: x@y.z' }), /newline|control|message-id/i);
  assert.throws(() => buildMimeMessage({ ...BASE, to: [] }), /recipient/i);
  assert.ok(!buildMimeMessage({ ...BASE, text: 'line1\r\nBcc: not-a-header' }).split('\r\n\r\n')[0].includes('Bcc'), 'body text cannot reach the headers');
});

test('dotStuff doubles leading dots and normalises line endings', () => {
  assert.equal(dotStuff('a\n.b\r\n..c\r\n.'), 'a\r\n..b\r\n...c\r\n..');
  assert.equal(dotStuff('plain'), 'plain');
});

// ---------------------------------------------------------------- SMTP transport
const MSG = { from: 'Decision Log <noreply@example.com>', to: ['bob@acme.com'], subject: 'Hi', text: 'Body text' };
const smtp = (server, extra = {}) => new SmtpTransport({ host: '127.0.0.1', port: server.port, timeoutMs: 2000, name: 'client.test', ...extra });

test('SMTP: a complete session delivers the message and reports acceptance', async () => {
  const server = await startMockSmtp();
  try {
    const res = await smtp(server).send({ ...MSG, to: ['bob@acme.com', 'carol@acme.com'], html: '<b>hi</b>', messageId: '<fixed@example.com>' });
    assert.deepEqual(res.accepted, ['bob@acme.com', 'carol@acme.com']);
    assert.deepEqual(res.rejected, []);
    assert.equal(res.id, '<fixed@example.com>');
    const s = server.sessions[0];
    assert.deepEqual(s.commands, ['EHLO client.test', 'MAIL FROM:<noreply@example.com>', 'RCPT TO:<bob@acme.com>', 'RCPT TO:<carol@acme.com>', 'DATA', 'QUIT']);
    const { headers } = parseMime(s.message);
    assert.equal(headers.subject, 'Hi');
    assert.equal(headers['message-id'], '<fixed@example.com>');
    assert.deepEqual(parts(s.message).map((p) => p.text), ['Body text', '<b>hi</b>']);
  } finally { await server.close(); }
});

test('SMTP: AUTH PLAIN, with AUTH LOGIN as fallback; bad credentials are reported', async () => {
  const plain = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
  const login = await startMockSmtp({ auth: { user: 'u', pass: 'p', mechs: ['LOGIN'] } });
  try {
    await smtp(plain, { auth: { user: 'u', pass: 'p' } }).send(MSG);
    assert.equal(plain.sessions[0].authUser, 'u');
    await smtp(login, { auth: { user: 'u', pass: 'p' } }).send(MSG);
    assert.equal(login.sessions[0].authUser, 'u');
    await assert.rejects(smtp(plain, { auth: { user: 'u', pass: 'wrong' } }).send(MSG), (e) => e instanceof SmtpError && e.code === 535 && e.retryable === true);
  } finally { await plain.close(); await login.close(); }
});

test('SMTP: credentials are never sent over an unencrypted non-loopback connection', async () => {
  const server = await startMockSmtp({ auth: { user: 'u', pass: 'p' } });
  const dial = () => net.connect(server.port, '127.0.0.1');
  try {
    const t = new SmtpTransport({ host: 'mail.example.com', port: 25, dial, auth: { user: 'u', pass: 'p' }, timeoutMs: 2000 });
    await assert.rejects(t.send(MSG), (e) => /unencrypted/i.test(e.message) && e.retryable === false);
    assert.equal(server.sessions[0].authUser, null);
    assert.ok(!server.sessions[0].commands.some((c) => c.startsWith('AUTH')));
    await new SmtpTransport({ host: 'mail.example.com', port: 25, dial, auth: { user: 'u', pass: 'p' }, allowInsecureAuth: true, timeoutMs: 2000 }).send(MSG);
    assert.equal(server.sessions[1].authUser, 'u', 'explicit opt-in');
  } finally { await server.close(); }
});

const cert = makeCert();
test('SMTP: STARTTLS upgrades the connection before authenticating', { skip: !cert && 'openssl unavailable' }, async () => {
  const server = await startMockSmtp({ tlsOptions: cert, auth: { user: 'u', pass: 'p' } });
  try {
    const t = new SmtpTransport({ host: 'mail.example.com', port: 587, dial: () => net.connect(server.port, '127.0.0.1'), starttls: 'required', tls: { rejectUnauthorized: false }, auth: { user: 'u', pass: 'p' }, timeoutMs: 3000, name: 'c.test' });
    await t.send(MSG);
    const s = server.sessions[0];
    assert.equal(s.tls, true);
    assert.equal(s.ehloCount, 2, 'EHLO is repeated after the upgrade');
    assert.equal(s.authUser, 'u', 'credentials allowed because the channel is encrypted');
    assert.ok(s.commands.indexOf('STARTTLS') < s.commands.findIndex((c) => c.startsWith('AUTH')));
    assert.match(s.message, /Subject: Hi/);
  } finally { await server.close(); }
});

test('SMTP: certificates are verified by default', { skip: !cert && 'openssl unavailable' }, async () => {
  const server = await startMockSmtp({ tlsOptions: cert });
  try {
    const t = new SmtpTransport({ host: 'localhost', port: 587, dial: () => net.connect(server.port, '127.0.0.1'), starttls: 'required', timeoutMs: 3000 });
    await assert.rejects(t.send(MSG), (e) => e instanceof SmtpError && /self.signed|certificate|verify/i.test(e.message));
  } finally { await server.close(); }
});

test('SMTP: implicit TLS (smtps)', { skip: !cert && 'openssl unavailable' }, async () => {
  const server = await startMockSmtp({ tlsOptions: cert, implicitTls: true });
  try {
    await new SmtpTransport({ host: '127.0.0.1', port: server.port, secure: true, tls: { rejectUnauthorized: false }, timeoutMs: 3000 }).send(MSG);
    assert.equal(server.sessions[0].tls, true);
    assert.match(server.sessions[0].message, /Subject: Hi/);
  } finally { await server.close(); }
});

test('SMTP: STARTTLS policy — required fails closed, auto continues in plaintext, never ignores the offer', async () => {
  const noTls = await startMockSmtp();
  try {
    await assert.rejects(smtp(noTls, { starttls: 'required' }).send(MSG), (e) => /STARTTLS/.test(e.message) && e.retryable === true);
    await smtp(noTls, { starttls: 'auto' }).send(MSG);
    assert.equal(noTls.sessions.at(-1).tls, false);
  } finally { await noTls.close(); }
  if (cert) {
    const offers = await startMockSmtp({ tlsOptions: cert });
    try {
      await smtp(offers, { starttls: 'never' }).send(MSG);
      assert.ok(!offers.sessions[0].commands.includes('STARTTLS'));
    } finally { await offers.close(); }
  }
});

test('SMTP: recipient outcomes — partial acceptance succeeds, total rejection is classified by reply class', async () => {
  const partial = await startMockSmtp({ rcpt: { 'gone@acme.com': '550 5.1.1 no such user' } });
  const permanent = await startMockSmtp({ rcpt: { 'gone@acme.com': '550 5.1.1 no such user' } });
  const temporary = await startMockSmtp({ rcpt: { 'busy@acme.com': '450 4.2.0 mailbox busy' } });
  try {
    const res = await smtp(partial).send({ ...MSG, to: ['bob@acme.com', 'gone@acme.com'] });
    assert.deepEqual(res.accepted, ['bob@acme.com']);
    assert.deepEqual(res.rejected, [{ address: 'gone@acme.com', code: 550, response: '5.1.1 no such user' }]);
    await assert.rejects(smtp(permanent).send({ ...MSG, to: ['gone@acme.com'] }), (e) => e.code === 550 && e.retryable === false);
    await assert.rejects(smtp(temporary).send({ ...MSG, to: ['busy@acme.com'] }), (e) => e.code === 450 && e.retryable === true);
    assert.ok(permanent.sessions[0].commands.includes('QUIT'), 'closes politely even on failure');
  } finally { await partial.close(); await permanent.close(); await temporary.close(); }
});

test('SMTP: DATA and MAIL rejections are classified', async () => {
  const rejectData = await startMockSmtp({ data: '554 5.7.1 message rejected as spam' });
  const deferData = await startMockSmtp({ data: '451 4.3.0 try again later' });
  const rejectFrom = await startMockSmtp({ mail: '553 5.7.1 sender not allowed' });
  try {
    await assert.rejects(smtp(rejectData).send(MSG), (e) => e.code === 554 && e.retryable === false);
    await assert.rejects(smtp(deferData).send(MSG), (e) => e.code === 451 && e.retryable === true);
    await assert.rejects(smtp(rejectFrom).send(MSG), (e) => e.code === 553 && e.retryable === false);
  } finally { await rejectData.close(); await deferData.close(); await rejectFrom.close(); }
});

test('SMTP: network failures and timeouts are retryable', async () => {
  const closed = await startMockSmtp();
  const port = closed.port;
  await closed.close();
  await assert.rejects(new SmtpTransport({ host: '127.0.0.1', port, timeoutMs: 500 }).send(MSG), (e) => e instanceof SmtpError && e.retryable === true);
  const silent = await startMockSmtp({ silent: true });
  try {
    await assert.rejects(smtp(silent, { timeoutMs: 150 }).send(MSG), (e) => /timed out/i.test(e.message) && e.retryable === true);
  } finally { await silent.close(); }
  const bad = await startMockSmtp({ greeting: '554 no service' });
  try {
    await assert.rejects(smtp(bad).send(MSG), (e) => e.code === 554 && e.retryable === false);
  } finally { await bad.close(); }
});

test('SMTP: unsafe envelopes are rejected before any connection is made', async () => {
  const server = await startMockSmtp();
  try {
    const t = smtp(server);
    await assert.rejects(t.send({ ...MSG, to: ['a@b.co>\r\nRCPT TO:<evil@x.io'] }), /address/i);
    await assert.rejects(t.send({ ...MSG, from: 'x@y.zz\r\nDATA' }), /address|newline|control/i);
    await assert.rejects(t.send({ ...MSG, to: [] }), /recipient/i);
    assert.equal(server.sessions.length, 0);
  } finally { await server.close(); }
});

test('parseSmtpUrl understands smtp://, smtps:// and options', () => {
  assert.deepEqual(parseSmtpUrl('smtp://us%40er:p%3Ass@mail.example.com:2525?starttls=required'), { host: 'mail.example.com', port: 2525, secure: false, starttls: 'required', auth: { user: 'us@er', pass: 'p:ss' } });
  assert.deepEqual(parseSmtpUrl('smtps://mail.example.com'), { host: 'mail.example.com', port: 465, secure: true, starttls: 'auto', auth: null });
  assert.equal(parseSmtpUrl('smtp://mail.example.com').port, 587);
  assert.throws(() => parseSmtpUrl('http://mail.example.com'), /smtp/i);
  assert.throws(() => parseSmtpUrl('smtp://'), /host/i);
  assert.throws(() => parseSmtpUrl('smtp://h?starttls=maybe'), /starttls/i);
});

// ---------------------------------------------------------------- EmailChannel
const PAYLOAD = createNotificationPayload({
  id: 'notif-007', type: 'decision_proposed', priority: 'high',
  recipient: { user: U.bob, email: U.bob },
  content: { title: '[PRJ-001] Decision <b>proposed</b>', body: 'Alice proposed "Use Postgres" & more.\nSecond line.', link: 'https://dl.example.com/#/d/PRJ-001' },
  context: { decision_id: 'PRJ-001', project: 'PRJ' },
});
const NO_EMAIL = createNotificationPayload({ ...PAYLOAD, recipient: { user: 'x' } });

test('EmailChannel satisfies the channel contract', async () => {
  const ch = new EmailChannel({ transport: new MemoryMailTransport(), from: 'Decision Log <noreply@example.com>' });
  assert.equal(ch.name, 'email');
  assert.deepEqual(await checkChannelConformance(ch, { payload: PAYLOAD, unaddressable: NO_EMAIL }), []);
  assert.equal(ch.supports(PAYLOAD), true);
  assert.equal(ch.supports(NO_EMAIL), false);
  assert.throws(() => new EmailChannel({ transport: new MemoryMailTransport() }), /from/);
  assert.throws(() => new EmailChannel({ from: 'a@b.co' }), /transport/);
  assert.throws(() => new EmailChannel({ transport: {}, from: 'a@b.co' }), /transport/);
  assert.throws(() => new EmailChannel({ transport: new MemoryMailTransport(), from: 'not an address' }), /address/i);
});

test('EmailChannel renders safe text and HTML with stable identifiers', async () => {
  const transport = new MemoryMailTransport();
  const ch = new EmailChannel({ transport, from: 'Decision Log <noreply@example.com>', replyTo: 'help@example.com', appName: 'Decision Log' });
  const result = await ch.send(PAYLOAD);
  assert.deepEqual(result, { status: 'sent', provider_id: '<notif-007.email@example.com>' });
  const m = transport.sent[0];
  assert.deepEqual(m.to, ['bob@acme.com']);
  assert.equal(m.from, 'Decision Log <noreply@example.com>');
  assert.equal(m.replyTo, 'help@example.com');
  assert.equal(m.subject, '[PRJ-001] Decision <b>proposed</b>');
  assert.match(m.text, /Alice proposed "Use Postgres" & more\.\nSecond line\./);
  assert.match(m.text, /https:\/\/dl\.example\.com\/#\/d\/PRJ-001/);
  assert.equal(m.html.includes('<b>proposed</b>'), false, 'title is HTML-escaped');
  assert.match(m.html, /&lt;b&gt;proposed&lt;\/b&gt;/);
  assert.match(m.html, /&amp; more/);
  assert.match(m.html, /<a href="https:\/\/dl\.example\.com\/#\/d\/PRJ-001"/);
  assert.match(m.html, /Second line/);
  assert.equal(m.messageId, '<notif-007.email@example.com>');
  assert.equal(m.headers['Auto-Submitted'], 'auto-generated');
  assert.equal(m.headers['X-Decision-Log-Notification'], 'notif-007');
  assert.equal(m.headers['X-Decision-Log-Type'], 'decision_proposed');
  assert.equal(m.headers.Importance, 'high');
  await ch.send(PAYLOAD);
  assert.equal(transport.sent[1].messageId, m.messageId, 'retries reuse the Message-ID so mail clients can de-duplicate');
});

test('EmailChannel sanitises subjects and trusts caller HTML only when supplied', async () => {
  const transport = new MemoryMailTransport();
  const ch = new EmailChannel({ transport, from: 'noreply@example.com' });
  await ch.send(createNotificationPayload({ ...PAYLOAD, content: { ...PAYLOAD.content, title: 'Line one\r\nBcc: x@y.zz' } }));
  assert.equal(transport.sent[0].subject, 'Line one Bcc: x@y.zz');
  await ch.send(createNotificationPayload({ ...PAYLOAD, id: 'n2', content: { ...PAYLOAD.content, html: '<h1>Custom</h1>' } }));
  assert.equal(transport.sent[1].html, '<h1>Custom</h1>');
});

test('EmailChannel maps transport errors onto retryable/permanent results', async () => {
  const mk = (err) => new EmailChannel({ from: 'noreply@example.com', transport: { async send() { throw err; } } });
  const retry = Object.assign(new Error('451 try later'), { retryable: true });
  const perm = Object.assign(new Error('550 no such user'), { retryable: false });
  assert.deepEqual(await mk(retry).send(PAYLOAD), { status: 'failed', error: '451 try later', retryable: true });
  assert.deepEqual(await mk(perm).send(PAYLOAD), { status: 'failed', error: '550 no such user', retryable: false });
  assert.equal((await mk(new Error('weird')).send(PAYLOAD)).retryable, true, 'unknown errors default to retryable');
});

// ---------------------------------------------------------------- end to end: manager -> EmailChannel -> SMTP
test('end to end: team members receive real emails over SMTP, and transient failures are retried', async () => {
  const server = await startMockSmtp({ rcpt: { 'carol@acme.com': '451 4.2.1 greylisted, try again' } });
  try {
    const { log } = setup();
    const manager = new NotificationManager(log, { appUrl: 'https://dl.example.com' });
    manager.register(new EmailChannel({ transport: smtp(server), from: 'Decision Log <noreply@example.com>' }));
    const id = proposed(log);
    const stats = await manager.run();
    assert.equal(stats.sent, 3, 'bob, david and the lead');
    assert.equal(stats.retrying, 1, 'carol was greylisted');
    const mails = server.sessions.filter((s) => s.message);
    assert.deepEqual(mails.map((s) => s.rcpts[0]).sort(), ['bob@acme.com', 'david@acme.com', 'lead@acme.com']);
    const bob = mails.find((s) => s.rcpts[0] === 'bob@acme.com');
    const { headers } = parseMime(bob.message);
    assert.equal(decodeWords(headers.subject), `[${id}] Decision proposed for review`);
    assert.ok(parts(bob.message)[0].text.includes(`https://dl.example.com/#/d/${id}`));
  } finally { await server.close(); }
});

test('end to end retry: the greylisted recipient succeeds on the next attempt', async () => {
  let attempts = 0;
  const flaky = {
    async send(message) {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('451 greylisted'), { retryable: true });
      return { id: message.messageId, accepted: message.to, rejected: [] };
    },
  };
  const { log, clock } = setup();
  const manager = new NotificationManager(log);
  manager.register(new EmailChannel({ transport: flaky, from: 'noreply@example.com' }));
  log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
  log.perform('PRJ-001', U.alice, { action: 'propose' });
  log.store.notifications.splice(1);
  assert.equal((await manager.run()).retrying, 1);
  clock.advanceMinutes(2);
  assert.equal((await manager.run()).sent, 1);
  assert.equal(log.store.channel_deliveries[0].status, 'sent');
});
