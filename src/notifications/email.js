import { NotificationChannel } from './channel.js';
import { sent, failed } from './payload.js';
import { parseAddress, formatAddress } from './mime.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * MailTransport interface (what EmailChannel needs): `async send(message)` where message is
 * `{ from, to: string[], replyTo?, subject, text, html, messageId, headers }`, resolving with
 * `{ id, accepted?, rejected? }` and throwing errors that carry `retryable: boolean` when it knows.
 * Implementations: SmtpTransport (production), MemoryMailTransport (tests/dev).
 */
export class MemoryMailTransport {
  constructor() { this.sent = []; }
  async send(message) {
    this.sent.push(structuredClone(message));
    return { id: message.messageId, accepted: [...message.to], rejected: [] };
  }
}

export class EmailChannel extends NotificationChannel {
  constructor({ transport, from, replyTo = null, appName = 'Decision Log' } = {}) {
    super();
    if (!transport || typeof transport.send !== 'function') throw new Error('EmailChannel requires a transport with send(message)');
    if (!from) throw new Error('EmailChannel requires a from address');
    this.from = formatAddress(parseAddress(from)); // validates
    this.replyTo = replyTo ? formatAddress(parseAddress(replyTo)) : null;
    this.fromDomain = parseAddress(from).address.split('@')[1];
    Object.assign(this, { transport, appName });
  }

  get name() { return 'email'; }

  supports(payload) { return typeof payload.recipient.email === 'string' && payload.recipient.email.length > 0; }

  render(payload) {
    const { title, body, link, html } = payload.content;
    const subject = title.replace(/[\r\n]+/g, ' ').trim();
    const footer = `You are receiving this because of your ${this.appName} notification settings.`;
    const text = [title, '', body, ...(link ? ['', `Open: ${link}`] : []), '', '--', footer].join('\n');
    const generated = [
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">',
      `<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>`,
      `<p style="white-space:pre-wrap">${escapeHtml(body)}</p>`,
      link ? `<p><a href="${escapeHtml(link)}">Open in ${escapeHtml(this.appName)}</a></p>` : '',
      `<hr style="border:none;border-top:1px solid #ddd"><p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`,
      '</div>',
    ].join('');
    const idPart = payload.id.replace(/[^A-Za-z0-9._-]/g, '-');
    return {
      from: this.from,
      to: [payload.recipient.email],
      replyTo: this.replyTo ?? undefined,
      subject,
      text,
      html: html ?? generated,
      messageId: `<${idPart}.email@${this.fromDomain}>`,
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Decision-Log-Notification': payload.id,
        'X-Decision-Log-Type': payload.type,
        ...(payload.priority === 'high' ? { Importance: 'high' } : {}),
      },
    };
  }

  async send(payload) {
    try {
      const res = await this.transport.send(this.render(payload));
      return sent(res?.id);
    } catch (e) {
      return failed(e.message, { retryable: e.retryable ?? true });
    }
  }
}
