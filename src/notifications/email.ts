import { createTransport } from 'nodemailer';
import type { DeliveryResult, NotificationChannel, NotificationPayload } from './index';

/** What the email channel hands to a transport. */
export interface MailMessage {
  /** Address or `Name <address>`. */
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Derived from the notification id, so a retry is recognisable as a duplicate. */
  messageId: string;
  headers: Record<string, string>;
}

/** Carries a message. Rejects with `retryable: false` on the error for permanent failures (bad address, blocked content). */
export interface MailTransport {
  send(message: MailMessage): Promise<{ id: string }>;
}

/** Nodemailer over SMTP, e.g. `smtp://user:pass@host:587` or `smtps://user:pass@host:465`. 5xx replies are permanent failures. */
export const smtpTransport = (url: string): MailTransport => {
  const transporter = createTransport(url);
  return {
    async send(message) {
      try {
        const info = await transporter.sendMail(message);
        return { id: info.messageId };
      } catch (error) {
        const code = (error as { responseCode?: number }).responseCode;
        throw Object.assign(error as Error, { retryable: !(code && code >= 500) });
      }
    },
  };
};

export interface EmailChannelOptions {
  transport: MailTransport;
  from: string;
  replyTo?: string;
}

/** Delivers notifications by email: render, hand to the transport, map the outcome onto a `DeliveryResult`. */
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';

  constructor(readonly options: EmailChannelOptions) {
    if (!options.from) throw new Error('EmailChannel needs a from address');
    if (typeof options.transport?.send !== 'function') throw new Error('EmailChannel needs a transport with send()');
  }

  async send(payload: NotificationPayload, addresses: string[]): Promise<DeliveryResult> {
    const message = render(payload, addresses, this.options);
    try {
      await this.options.transport.send(message);
      return { status: 'sent', provider_id: message.messageId };
    } catch (error) {
      const { message: text, retryable } = error as Error & { retryable?: boolean };
      return { status: 'failed', error: text, retryable: retryable ?? true };
    }
  }
}

const render = (payload: NotificationPayload, to: string[], { from, replyTo }: EmailChannelOptions): MailMessage => {
  const domain = /@([^>\s]+)/.exec(from)?.[1] ?? 'localhost';
  const link = payload.link ? `\n\n${payload.link}` : '';
  const htmlLink = payload.link ? `<p><a href="${escapeHtml(payload.link)}">${escapeHtml(payload.link)}</a></p>` : '';
  return {
    from,
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: payload.title.replace(/[\r\n]+/g, ' '),
    text: `${payload.body}${link}`,
    html: `<p>${escapeHtml(payload.body).replace(/\n/g, '<br>')}</p>${htmlLink}`,
    messageId: `<${payload.id}@${domain}>`,
    headers: { 'Auto-Submitted': 'auto-generated' },
  };
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
