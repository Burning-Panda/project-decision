import { onCleanup } from './cleanup';

export interface MockSmtpSession {
  commands: string[];
  from: string | null;
  rcpts: string[];
  message: string | null;
  closed: boolean;
}

/**
 * Minimal scriptable plain-text SMTP server on Bun.listen, stopped after the test. Options:
 *   caps        EHLO capability lines
 *   rcpt        { 'addr@x': '550 reply' }   per-recipient replies (default 250)
 *   mail, data  replies for MAIL FROM / end of DATA
 *   greeting    the 220 banner
 */
export async function startMockSmtp({
  caps = ['8BITMIME'], rcpt = {} as Record<string, string>, mail = '250 ok', data = '250 2.0.0 queued as MOCK1',
  greeting = '220 mock ESMTP',
} = {}) {
  const sessions: MockSmtpSession[] = [];

  const reply = (st: any, ...lines: string[]) =>
    st.sock.write(lines.map((l, i) => `${l.slice(0, 3)}${i < lines.length - 1 ? '-' : ' '}${l.slice(4)}\r\n`).join(''));

  const handleLine = (st: any, line: string) => {
    const s: MockSmtpSession = st.s;
    s.commands.push(line);
    const verb = line.split(' ')[0]!.toUpperCase();
    if (verb === 'EHLO') reply(st, '250 mock.local', ...caps.map((c) => `250 ${c}`));
    else if (verb === 'MAIL') { s.from = line.match(/<([^>]*)>/)?.[1] ?? null; reply(st, mail); }
    else if (verb === 'RCPT') {
      const addr = line.match(/<([^>]*)>/)?.[1] as string;
      const r = rcpt[addr] ?? '250 ok';
      if (r.startsWith('25')) s.rcpts.push(addr);
      reply(st, r);
    } else if (verb === 'DATA') { st.mode = 'data'; s.message = ''; reply(st, '354 end with <CRLF>.<CRLF>'); }
    else if (verb === 'QUIT') { reply(st, '221 bye'); st.sock.end(); }
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

  const server = Bun.listen<any>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        const s: MockSmtpSession = { commands: [], from: null, rcpts: [], message: null, closed: false };
        sessions.push(s);
        socket.data = { s, buffer: '', mode: 'cmd', sock: socket };
        socket.write(`${greeting}\r\n`);
      },
      data(socket, chunk) { onData(socket.data, chunk); },
      close(socket) { socket.data.s.closed = true; },
      error() {},
    },
  });
  const close = async () => { server.stop(true); };
  onCleanup(close);
  return { port: server.port, sessions, close };
}
