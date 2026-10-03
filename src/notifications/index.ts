/** Id of a channel; users enable and disable channels by this name. */
export type ChannelName = 'email' | 'sms' | 'push' | (string & {});

/** The one channel-agnostic structure every channel receives. Built by the caller. */
export interface NotificationPayload {
  /** Unique per notification; channels use it as their idempotency key. */
  id: string;
  /** What happened, e.g. `decision_proposed`. Recipients can mute types. */
  type: string;
  /** Where to reach the user, per channel. A channel with no addresses is skipped. */
  recipient: { user: string; addresses: Partial<Record<ChannelName, string[]>> };
  title: string;
  body: string;
  link: string | null;
  /** Domain extras (decision id, project, actor...) the notifications module never reads. */
  data: Record<string, unknown>;
}

export type DeliveryResult =
  | { status: 'sent'; provider_id: string | null }
  | { status: 'failed'; error: string; retryable: boolean }
  | { status: 'skipped'; reason: string };

/** One delivery service. Implement it, then `notifier.register(new MyChannel())`. */
export interface NotificationChannel {
  readonly name: ChannelName;
  /** Delivers ONE payload to the recipient's addresses for this channel (never empty). A throw is reported as a retryable failure. */
  send(payload: NotificationPayload, addresses: string[]): Promise<DeliveryResult>;
}

/** How one recipient wants to be notified. Plain data supplied by the caller. */
export interface NotificationPreferences {
  /** Per-channel switch; channels not listed are on. */
  channels?: Partial<Record<ChannelName, boolean>>;
  /** Notification types the recipient does not want. */
  muted_types?: readonly string[];
}

export interface ChannelDelivery {
  channel: ChannelName;
  result: DeliveryResult;
}

const REQUIRED = ['id', 'type', 'title', 'body'] as const;

/** Sends a notification through every registered, enabled channel. Keeps no queue, retries or history. */
export class Notifier {
  readonly #channels = new Map<ChannelName, NotificationChannel>();

  /** Names of the registered channels, in registration order. */
  get channelNames(): ChannelName[] {
    return [...this.#channels.keys()];
  }

  /** Adds a channel. Throws if the name is taken. */
  register(channel: NotificationChannel): this {
    if (this.#channels.has(channel.name)) throw new Error(`Channel "${channel.name}" is already registered`);
    this.#channels.set(channel.name, channel);
    return this;
  }

  /**
   * Resolves with one entry per enabled channel, in registration order: `skipped` (`no_address`) when the recipient has
   * no address for it, otherwise what the channel returned. Rejects when a required field is empty; a muted type resolves with `[]`.
   */
  async send(payload: NotificationPayload, preferences: NotificationPreferences = {}): Promise<ChannelDelivery[]> {
    for (const field of REQUIRED) {
      if (!payload[field]) throw new Error(`Notification ${field} is required`);
    }
    if (!payload.recipient?.user) throw new Error('Notification recipient.user is required');
    if (preferences.muted_types?.includes(payload.type)) return [];

    const enabled = [...this.#channels.values()].filter((channel) => preferences.channels?.[channel.name] !== false);
    return Promise.all(enabled.map(async (channel) => ({ channel: channel.name, result: await deliver(channel, payload) })));
  }
}

const deliver = async (channel: NotificationChannel, payload: NotificationPayload): Promise<DeliveryResult> => {
  const addresses = payload.recipient.addresses[channel.name] ?? [];
  if (addresses.length === 0) return { status: 'skipped', reason: 'no_address' };
  try {
    return await channel.send(payload, addresses);
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error), retryable: true };
  }
};
