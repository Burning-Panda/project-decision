import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildMimeMessage, dotStuff, parseAddress } from './mime.js';

export class SmtpError extends Error {
  /** `retryable` is true for transient problems (network, 4xx, config the operator can fix) and false for permanent rejections. */
  constructor(message, { code = null, retryable = true } = {}) {
    super(message);
    this.name = 'SmtpError';
    this.code = code;
    this.retryable = retryable;
  }
}

const isLoopback = (host) => host === 'localhost' || /^127\./.test(host) || host === '::1' || host === '[::1]';
const classify = (code) => code >= 500; // permanent?

/** Reads SMTP replies (including multi-line `250-` continuations) from a socket. */
class ReplyReader {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.lines = [];
    this.waiter = null;
    this.failure = null;
    this.onData = (chunk) => { this.buffer += chunk.toString('utf8'); this.flush(); };
    this.onError = (e) => this.fail(new SmtpError(`connection error: ${e.message}`));
    this.onClose = () => this.fail(new SmtpError('connection closed unexpectedly'));
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  fail(err) {
    this.failure ??= err;
    if (this.waiter) { const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.reject(this.failure); }
  }

  flush() {
    let i;
    while ((i = this.buffer.indexOf('\r\n')) !== -1) { this.lines.push(this.buffer.slice(0, i)); this.buffer = this.buffer.slice(i + 2); }
    this.tryResolve();
  }

  tryResolve() {
    if (!this.waiter) return;
    // A reply is complete at the first line whose 4th character is a space (or that is exactly the 3-digit code).
    const end = this.lines.findIndex((l) => /^\d{3}( |$)/.test(l));
    if (end === -1) return;
    const block = this.lines.splice(0, end + 1);
    const w = this.waiter;
    this.waiter = null;
    clearTimeout(w.timer);
    w.resolve({ code: Number(block[0].slice(0, 3)), lines: block.map((l) => l.slice(4)), text: block.map((l) => l.slice(4)).join(' ') });
  }

  read(timeoutMs = this.timeoutMs) {
    if (this.failure && !this.lines.length) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; reject(new SmtpError('SMTP server timed out')); }, timeoutMs);
      this.waiter = { resolve, reject, timer };
      this.tryResolve();
    });
  }
}

/**
 * Dependency-free SMTP submission client (RFC 5321) with STARTTLS / implicit TLS, AUTH PLAIN/LOGIN and strict
 * recipient handling. Credentials are only sent over an encrypted channel (or to loopback) unless
 * `allowInsecureAuth` is set. Certificates are verified unless you override `tls.rejectUnauthorized`.
 *
 * Implements the MailTransport interface: `send(message) -> { id, accepted, rejected }`, throwing SmtpError
 * (with `.retryable`) on failure.
 */
export class SmtpTransport {
  constructor({ host, port, secure = false, starttls = 'auto', auth = null, name = os.hostname() || 'localhost', timeoutMs = 10_000, tls: tlsOptions = {}, allowInsecureAuth = false, dial } = {}) {
    if (!host) throw new Error('SmtpTransport requires a host');
    if (!['auto', 'required', 'never'].includes(starttls)) throw new Error('starttls must be auto, required or never');
    Object.assign(this, { host, port: port ?? (secure ? 465 : 587), secure, starttls, auth, name, timeoutMs, tlsOptions, allowInsecureAuth, dial });
  }

  connect() {
    if (this.dial) return this.dial();
    const opts = { host: this.host, port: this.port };
    return this.secure ? tls.connect({ ...opts, servername: this.host, ...this.tlsOptions }) : net.connect(opts);
  }

  async send(message) {
    // Validate everything before touching the network.
    const from = parseAddress(message.from);
    const recipients = (message.to ?? []).map((a) => parseAddress(a).address);
    if (!recipients.length) throw new Error('at least one recipient is required');
    const messageId = message.messageId ?? `<${randomUUID()}@${from.address.split('@')[1]}>`;
    const raw = buildMimeMessage({ ...message, messageId });

    let socket;
    let reader;
    const cmd = async (line, expected, label = line.split(' ')[0]) => {
      socket.write(`${line}\r\n`);
      const reply = await reader.read();
      if (!expected.includes(reply.code)) throw new SmtpError(`${label} rejected: ${reply.code} ${reply.text}`, { code: reply.code, retryable: label === 'AUTH' || !classify(reply.code) }); // auth failures are operator-fixable config problems
      return reply;
    };

    // Best effort: say goodbye and wait (briefly) for 221 so the server sees a clean close.
    const quit = async () => {
      try {
        if (!socket || socket.destroyed || !reader) return;
        socket.write('QUIT\r\n');
        await reader.read(1000);
      } catch { /* the message outcome is already decided */ }
    };

    try {
      socket = this.connect();
      socket.setTimeout?.(this.timeoutMs * 3, () => socket.destroy(new Error('socket timed out')));
      reader = new ReplyReader(socket, this.timeoutMs);
      await new Promise((resolve, reject) => {
        const ready = this.secure && !this.dial ? 'secureConnect' : 'connect';
        if ((socket.connecting === false && ready === 'connect') || socket.readyState === 'open') return resolve();
        const t = setTimeout(() => reject(new SmtpError('connection timed out')), this.timeoutMs);
        socket.once(ready, () => { clearTimeout(t); resolve(); });
        socket.once('error', (e) => { clearTimeout(t); reject(new SmtpError(`connection failed: ${e.message}`)); });
      });

      const greeting = await reader.read();
      if (greeting.code !== 220) throw new SmtpError(`server refused the connection: ${greeting.code} ${greeting.text}`, { code: greeting.code, retryable: !classify(greeting.code) });

      let ehlo = await cmd(`EHLO ${this.name}`, [250]);
      const caps = () => ehlo.lines.map((l) => l.toUpperCase());
      let encrypted = this.secure;

      if (!encrypted && this.starttls !== 'never') {
        if (caps().includes('STARTTLS')) {
          await cmd('STARTTLS', [220]);
          reader.detach();
          socket = tls.connect({ socket, servername: this.host, ...this.tlsOptions });
          await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', (e) => reject(new SmtpError(`TLS negotiation failed: ${e.message}`))); });
          reader = new ReplyReader(socket, this.timeoutMs);
          ehlo = await cmd(`EHLO ${this.name}`, [250]);
          encrypted = true;
        } else if (this.starttls === 'required') {
          throw new SmtpError('server does not offer STARTTLS but it is required');
        }
      }

      if (this.auth) {
        if (!encrypted && !isLoopback(this.host) && !this.allowInsecureAuth) throw new SmtpError('refusing to send credentials over an unencrypted connection', { retryable: false });
        const mechs = (caps().find((c) => c.startsWith('AUTH ')) ?? '').slice(5).split(' ');
        const { user, pass } = this.auth;
        if (mechs.includes('PLAIN')) {
          await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235], 'AUTH');
        } else if (mechs.includes('LOGIN')) {
          await cmd('AUTH LOGIN', [334], 'AUTH');
          await cmd(Buffer.from(user).toString('base64'), [334], 'AUTH');
          await cmd(Buffer.from(pass).toString('base64'), [235], 'AUTH');
        } else {
          throw new SmtpError('server offers no supported AUTH mechanism (PLAIN, LOGIN)');
        }
      }

      await cmd(`MAIL FROM:<${from.address}>`, [250], 'MAIL FROM');
      const accepted = [];
      const rejected = [];
      let lastRcptError = null;
      for (const rcpt of recipients) {
        socket.write(`RCPT TO:<${rcpt}>\r\n`);
        const r = await reader.read();
        if (r.code === 250 || r.code === 251) accepted.push(rcpt);
        else { rejected.push({ address: rcpt, code: r.code, response: r.text }); lastRcptError = new SmtpError(`RCPT TO:<${rcpt}> rejected: ${r.code} ${r.text}`, { code: r.code, retryable: !classify(r.code) }); }
      }
      if (!accepted.length) throw lastRcptError;

      await cmd('DATA', [354]);
      socket.write(`${dotStuff(raw)}\r\n.\r\n`);
      const done = await reader.read();
      if (done.code !== 250) throw new SmtpError(`message rejected: ${done.code} ${done.text}`, { code: done.code, retryable: !classify(done.code) });

      await quit();
      return { id: messageId, accepted, rejected, response: done.text };
    } catch (e) {
      await quit();
      throw e instanceof SmtpError ? e : new SmtpError(`SMTP error: ${e.message}`);
    } finally {
      reader?.detach();
      socket?.on?.('error', () => {});
      socket?.end?.();
    }
  }
}

/** smtp://user:pass@host:587?starttls=required  |  smtps://host:465 */
export function parseSmtpUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('invalid SMTP url'); }
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('SMTP url must start with smtp:// or smtps://');
  if (!u.hostname) throw new Error('SMTP url needs a host');
  const secure = u.protocol === 'smtps:';
  const starttls = u.searchParams.get('starttls') ?? 'auto';
  if (!['auto', 'required', 'never'].includes(starttls)) throw new Error('starttls must be auto, required or never');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : secure ? 465 : 587,
    secure,
    starttls,
    auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : null,
  };
}
