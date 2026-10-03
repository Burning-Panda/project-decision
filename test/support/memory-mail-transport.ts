import type { MailMessage, MailTransport } from './target';

/** Test double: records every message and accepts it. */
export class MemoryMailTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<{ id: string }> {
    this.sent.push(message);
    return { id: message.messageId };
  }
}
