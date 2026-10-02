import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Self-signed cert for TLS tests; returns null when openssl is unavailable. */
export function makeCert() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-cert-'));
    const key = path.join(dir, 'k.pem'), cert = path.join(dir, 'c.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const out = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  } catch { return null; }
}

/**
 * Minimal scriptable SMTP server. Options:
 *   caps        EHLO capability lines
 *   auth        { user, pass, mechs: ['PLAIN','LOGIN'] } enables AUTH
 *   rcpt        { 'addr@x': '550 reply' }   per-recipient replies (default 250)
 *   mail, data  replies for MAIL FROM / end of DATA
 *   tlsOptions  { key, cert }: offers STARTTLS (or speaks TLS immediately with implicitTls)
 *   silent      never greet (timeout tests)
 */
export async function startMockSmtp({ caps = ['8BITMIME'], auth = null, rcpt = {}, mail = '250 ok', data = '250 2.0.0 queued as MOCK1', greeting = '220 mock ESMTP', tlsOptions = null, implicitTls = false, silent = false } = {}) {
  const sessions = [];
  const advertise = (tlsActive) => [
    ...caps,
    ...(tlsOptions && !implicitTls && !tlsActive ? ['STARTTLS'] : []),
    ...(auth ? [`AUTH ${(auth.mechs ?? ['PLAIN', 'LOGIN']).join(' ')}`] : []),
  ];

  const onConnection = (rawSocket) => {
    const s = { commands: [], from: null, rcpts: [], message: null, authUser: null, ehloCount: 0, tls: implicitTls, closed: false };
    sessions.push(s);
    let socket = rawSocket;
    let buffer = '';
    let mode = 'cmd'; // cmd | data | login-user | login-pass
    let loginUser = null;
    const reply = (...lines) => socket.write(lines.map((l, i) => `${l.slice(0, 3)}${i < lines.length - 1 ? '-' : ' '}${l.slice(4)}\r\n`).join(''));

    const handleLine = (line) => {
      if (mode === 'data') {
        buffer = '';
        return;
      }
      if (mode === 'login-user') { loginUser = Buffer.from(line, 'base64').toString(); mode = 'login-pass'; reply('334 UGFzc3dvcmQ6'); return; }
      if (mode === 'login-pass') {
        mode = 'cmd';
        const pass = Buffer.from(line, 'base64').toString();
        if (loginUser === auth.user && pass === auth.pass) { s.authUser = loginUser; reply('235 2.7.0 authenticated'); } else reply('535 5.7.8 bad credentials');
        return;
      }
      s.commands.push(line);
      const [verb, ...rest] = line.split(' ');
      const V = verb.toUpperCase();
      if (V === 'EHLO') { s.ehloCount++; const adv = advertise(s.tls); reply(...[`250 mock.local`, ...adv.map((c) => `250 ${c}`)]); }
      else if (V === 'STARTTLS') {
        reply('220 ready to start TLS');
        socket.removeAllListeners('data');
        const wrapped = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(tlsOptions) });
        socket = wrapped;
        s.tls = true;
        wrapped.on('data', onData);
        wrapped.on('error', () => {});
      } else if (V === 'AUTH') {
        const mech = rest[0]?.toUpperCase();
        if (mech === 'PLAIN') {
          const [, user, pass] = Buffer.from(rest[1] ?? '', 'base64').toString().split('\0');
          if (user === auth.user && pass === auth.pass) { s.authUser = user; reply('235 2.7.0 authenticated'); } else reply('535 5.7.8 bad credentials');
        } else if (mech === 'LOGIN') { mode = 'login-user'; reply('334 VXNlcm5hbWU6'); } else reply('504 unsupported mechanism');
      } else if (V === 'MAIL') { s.from = line.match(/<([^>]*)>/)?.[1]; reply(mail); }
      else if (V === 'RCPT') {
        const addr = line.match(/<([^>]*)>/)?.[1];
        const r = rcpt[addr] ?? '250 ok';
        if (r.startsWith('25')) s.rcpts.push(addr);
        reply(r);
      } else if (V === 'DATA') { mode = 'data'; s.message = ''; reply('354 end with <CRLF>.<CRLF>'); }
      else if (V === 'QUIT') { reply('221 bye'); socket.end(); }
      else reply('502 not implemented');
    };

    function onData(chunk) {
      buffer += chunk.toString('latin1');
      if (mode === 'data') {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        s.message = buffer.slice(0, end + 2).replace(/^\.\./gm, '.'); // un-dot-stuff
        buffer = buffer.slice(end + 5);
        mode = 'cmd';
        reply(data);
        return;
      }
      let i;
      while ((i = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        handleLine(line);
        if (mode === 'data') { if (buffer) onData(''); break; }
      }
    }

    socket.on('data', onData);
    socket.on('error', () => {});
    socket.on('close', () => { s.closed = true; });
    if (!silent) socket.write(`${greeting}\r\n`);
  };

  const server = implicitTls ? tls.createServer({ ...tlsOptions }, onConnection) : net.createServer(onConnection);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, sessions, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}
