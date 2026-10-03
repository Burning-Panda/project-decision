import { onCleanup } from './cleanup';

/** Self-signed cert for TLS tests; returns null when openssl is unavailable. */
export async function makeCert(): Promise<{ key: string; cert: string } | null> {
  try {
    const dir = Bun.spawnSync(['mktemp', '-d', '-t', 'dl-cert-XXXXXX']).stdout.toString().trim();
    const key = `${dir}/k.pem`, cert = `${dir}/c.pem`;
    const run = Bun.spawnSync(['openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdout: 'ignore', stderr: 'ignore' });
    const out = run.success ? { key: await Bun.file(key).text(), cert: await Bun.file(cert).text() } : null;
    Bun.spawnSync(['rm', '-rf', dir]);
    return out;
  } catch { return null; }
}

/**
 * Minimal scriptable SMTP server on Bun.listen. Options:
 *   caps        EHLO capability lines
 *   auth        { user, pass, mechs: ['PLAIN','LOGIN'] } enables AUTH
 *   rcpt        { 'addr@x': '550 reply' }   per-recipient replies (default 250)
 *   mail, data  replies for MAIL FROM / end of DATA
 *   tlsOptions  { key, cert }: offers STARTTLS (or speaks TLS immediately with implicitTls)
 *   silent      never greet (timeout tests)
 */
export async function startMockSmtp({
  caps = ['8BITMIME'], auth = null, rcpt = {}, mail = '250 ok', data = '250 2.0.0 queued as MOCK1',
  greeting = '220 mock ESMTP', tlsOptions = null, implicitTls = false, silent = false,
}: Record<string, any> = {}) {
  const sessions: any[] = [];
  const advertise = (tlsActive: boolean): string[] => [
    ...caps,
    ...(tlsOptions && !implicitTls && !tlsActive ? ['STARTTLS'] : []),
    ...(auth ? [`AUTH ${(auth.mechs ?? ['PLAIN', 'LOGIN']).join(' ')}`] : []),
  ];

  const reply = (st: any, ...lines: string[]) =>
    st.sock.write(lines.map((l, i) => `${l.slice(0, 3)}${i < lines.length - 1 ? '-' : ' '}${l.slice(4)}\r\n`).join(''));

  const handleLine = (st: any, line: string) => {
    const s = st.s;
    if (st.mode === 'login-user') { st.loginUser = Buffer.from(line, 'base64').toString(); st.mode = 'login-pass'; reply(st, '334 UGFzc3dvcmQ6'); return; }
    if (st.mode === 'login-pass') {
      st.mode = 'cmd';
      const pass = Buffer.from(line, 'base64').toString();
      if (st.loginUser === auth.user && pass === auth.pass) { s.authUser = st.loginUser; reply(st, '235 2.7.0 authenticated'); } else reply(st, '535 5.7.8 bad credentials');
      return;
    }
    s.commands.push(line);
    const [verb, ...rest] = line.split(' ');
    const V = verb.toUpperCase();
    if (V === 'EHLO') { s.ehloCount++; reply(st, ...['250 mock.local', ...advertise(s.tls).map((c) => `250 ${c}`)]); }
    else if (V === 'STARTTLS') {
      reply(st, '220 ready to start TLS');
      const [, upgraded] = st.sock.upgradeTLS({ isServer: true, tls: tlsOptions, socket: handlers, data: st });
      st.sock = upgraded;
      s.tls = true;
    } else if (V === 'AUTH') {
      const mech = rest[0]?.toUpperCase();
      if (mech === 'PLAIN') {
        const [, user, pass] = Buffer.from(rest[1] ?? '', 'base64').toString().split('\0');
        if (user === auth.user && pass === auth.pass) { s.authUser = user; reply(st, '235 2.7.0 authenticated'); } else reply(st, '535 5.7.8 bad credentials');
      } else if (mech === 'LOGIN') { st.mode = 'login-user'; reply(st, '334 VXNlcm5hbWU6'); } else reply(st, '504 unsupported mechanism');
    } else if (V === 'MAIL') { s.from = line.match(/<([^>]*)>/)?.[1]; reply(st, mail); }
    else if (V === 'RCPT') {
      const addr = line.match(/<([^>]*)>/)?.[1] as string;
      const r = rcpt[addr] ?? '250 ok';
      if (r.startsWith('25')) s.rcpts.push(addr);
      reply(st, r);
    } else if (V === 'DATA') { st.mode = 'data'; s.message = ''; reply(st, '354 end with <CRLF>.<CRLF>'); }
    else if (V === 'QUIT') { reply(st, '221 bye'); st.sock.end(); }
    else reply(st, '502 not implemented');
  };

  const onData = (st: any, chunk: Buffer | string) => {
    st.buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1');
    if (st.mode === 'data') {
      const end = st.buffer.indexOf('\r\n.\r\n');
      if (end === -1) return;
      st.s.message = st.buffer.slice(0, end + 2).replace(/^\.\./gm, '.'); // un-dot-stuff
      st.buffer = st.buffer.slice(end + 5);
      st.mode = 'cmd';
      reply(st, data);
      return;
    }
    let i: number;
    while ((i = st.buffer.indexOf('\r\n')) !== -1) {
      const line = st.buffer.slice(0, i);
      st.buffer = st.buffer.slice(i + 2);
      handleLine(st, line);
      if (st.mode === 'data') { if (st.buffer) onData(st, ''); break; }
    }
  };

  const handlers: any = {
    open(socket: any) {
      if (socket.data?.s) { socket.data.sock = socket; return; } // the STARTTLS-upgraded socket re-opens with the same session
      const s = { commands: [] as string[], from: null, rcpts: [] as string[], message: null, authUser: null, ehloCount: 0, tls: implicitTls, closed: false };
      sessions.push(s);
      socket.data = { s, buffer: '', mode: 'cmd', loginUser: null, sock: socket };
      if (!silent) socket.write(`${greeting}\r\n`);
    },
    data(socket: any, chunk: Buffer) {
      if (socket !== socket.data.sock) return; // ciphertext still arriving on the pre-upgrade raw socket
      onData(socket.data, chunk);
    },
    close(socket: any) { socket.data.s.closed = true; },
    error() {},
  };

  const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: handlers, ...(implicitTls ? { tls: tlsOptions } : {}) } as any);
  const close = async () => { server.stop(true); };
  onCleanup(close);
  return { port: server.port as number, sessions, close };
}
