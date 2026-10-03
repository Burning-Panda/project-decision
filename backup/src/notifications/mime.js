import { randomBytes } from 'node:crypto';
import { isValidEmail } from '../util.js';

const CTL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\r\n]/;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function assertNoControl(value, label) {
  if (CTL.test(value)) throw new Error(`${label} must not contain newlines or control characters`);
  return value;
}

/** RFC 2047 encoded-words (UTF-8, base64), split so that every word is at most 75 characters. */
export function encodeWord(text) {
  assertNoControl(text, 'header value');
  const chars = [...text];
  const words = [];
  let current = '';
  for (const ch of chars) {
    // 75 chars total = 12 for "=?UTF-8?B?" + "?=", leaving 63 → 45 bytes of payload
    if (Buffer.byteLength(current + ch) > 45) { words.push(current); current = ''; }
    current += ch;
  }
  if (current) words.push(current);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join(' ');
}

const needsEncoding = (s) => /[^\x20-\x7e]/.test(s);
const headerValue = (s) => (needsEncoding(s) ? encodeWord(s) : assertNoControl(s, 'header value'));

/** Parses `addr@host`, `Name <addr@host>` or `"Quoted, Name" <addr@host>` into {name, address}; throws on anything else. */
export function parseAddress(input) {
  const s = String(input ?? '').trim();
  assertNoControl(s, 'address');
  const bare = isValidEmail(s) ? s : null;
  if (bare) return { name: null, address: bare };
  const m = /^(?:"((?:[^"\\]|\\.)*)"|([^<>"]*?))\s*<([^<>\s]+)>$/.exec(s);
  if (!m || !isValidEmail(m[3])) throw new Error(`invalid address: ${JSON.stringify(s)}`);
  const name = (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]).trim();
  return { name: name || null, address: m[3] };
}

export function formatAddress({ name, address }) {
  if (!isValidEmail(address)) throw new Error(`invalid address: ${JSON.stringify(address)}`);
  if (!name) return address;
  if (needsEncoding(name)) return `${encodeWord(name)} <${address}>`;
  assertNoControl(name, 'display name');
  return /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/.test(name) ? `${name} <${address}>` : `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>`;
}

const base64Lines = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();

function rfc2822Date(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** Builds an RFC 5322 message (CRLF line endings). Body text is base64-encoded, so it can never inject headers. */
export function buildMimeMessage({ from, to, replyTo, subject, text, html, messageId, date = new Date(), headers = {} }) {
  if (!Array.isArray(to) || !to.length) throw new Error('at least one recipient is required');
  if (typeof messageId === 'string') {
    assertNoControl(messageId, 'Message-ID');
    if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(messageId)) throw new Error('invalid Message-ID');
  }
  const lines = [
    `Date: ${rfc2822Date(date)}`,
    `From: ${formatAddress(parseAddress(from))}`,
    `To: ${to.map((a) => formatAddress(parseAddress(a))).join(', ')}`,
  ];
  if (replyTo) lines.push(`Reply-To: ${formatAddress(parseAddress(replyTo))}`);
  lines.push(`Subject: ${headerValue(String(subject ?? ''))}`);
  if (messageId) lines.push(`Message-ID: ${messageId}`);
  lines.push('MIME-Version: 1.0');
  for (const [k, v] of Object.entries(headers)) {
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(k)) throw new Error(`invalid header name ${JSON.stringify(k)}`);
    lines.push(`${k}: ${headerValue(String(v))}`);
  }

  const part = (type, body) => `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(body)}`;
  if (html == null) return `${lines.join('\r\n')}\r\n${part('text/plain', text ?? '')}\r\n`;
  const boundary = `dl-${randomBytes(12).toString('hex')}`;
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  return `${lines.join('\r\n')}\r\n\r\n--${boundary}\r\n${part('text/plain', text ?? '')}\r\n--${boundary}\r\n${part('text/html', html)}\r\n--${boundary}--\r\n`;
}

/** SMTP transparency: normalise to CRLF and double any leading dot (RFC 5321 §4.5.2). */
export function dotStuff(message) {
  return message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}
