import { NotImplementedError } from '../common/errors';
import type { DecisionLog } from '../decision-log/decision-log';

// ---------------------------------------------------------------- contracts

/** Channels a user can enable in their preferences today. */
export type KnownChannelName = 'email' | 'sms' | 'push';
/** Unique lower_snake_case id of a channel (`/^[a-z][a-z0-9_]*$/`). */
export type ChannelName = KnownChannelName | (string & {});

export type NotificationPriority = 'low' | 'normal' | 'high';

export interface NotificationRecipient {
  user: string;
  email: string | null;
  phone: string | null;
  push_tokens: string[];
}

export interface NotificationContent {
  title: string;
  body: string;
  html: string | null;
  link: string | null;
}

export interface NotificationContext {
  decision_id: string | null;
  project: string | null;
  actor: string | null;
}

/** The one standard, channel-agnostic structure every channel receives. Deeply frozen. */
export interface NotificationPayload {
  readonly version: 1;
  readonly id: string;
  readonly type: string;
  readonly priority: NotificationPriority;
  readonly recipient: Readonly<NotificationRecipient>;
  readonly content: Readonly<NotificationContent>;
  readonly context: Readonly<NotificationContext>;
  readonly data: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  readonly dedupe_key: string;
}

/** What callers provide; everything except id, type, recipient.user and content.title/body is defaulted. */
export interface NotificationPayloadInput {
  id: string;
  type: string;
  priority?: NotificationPriority;
  recipient: Partial<NotificationRecipient> & Pick<NotificationRecipient, 'user'>;
  content: Partial<NotificationContent> & Pick<NotificationContent, 'title' | 'body'>;
  context?: Partial<NotificationContext>;
  data?: Record<string, unknown>;
  created_at?: string;
  dedupe_key?: string;
}

export type DeliveryResult =
  | { status: 'sent'; provider_id: string | null }
  | { status: 'failed'; error: string; retryable: boolean }
  | { status: 'skipped'; reason: string };

export type DeliveryStatus = DeliveryResult['status'];

// ---------------------------------------------------------------- channel (strategy)

/**
 * Strategy interface for one delivery service. Subclass it, implement the three members, then
 * `manager.register(new MyChannel())`. The base class is a stub: every member throws until overridden.
 */
export class NotificationChannel {
  /** Unique lower_snake_case id; users enable channels by this name. */
  get name(): ChannelName {
    throw new NotImplementedError('NotificationChannel.name must be implemented by the channel');
  }

  /** Synchronous and pure: true only if the recipient has the address this channel needs. */
  supports(_payload: NotificationPayload): boolean {
    throw new NotImplementedError('NotificationChannel.supports must be implemented by the channel');
  }

  /** Delivers ONE payload without mutating it. Idempotent for a given `payload.dedupe_key`. A throw counts as a retryable failure. */
  async send(_payload: NotificationPayload): Promise<DeliveryResult> {
    throw new NotImplementedError('NotificationChannel.send must be implemented by the channel');
  }
}

// ---------------------------------------------------------------- manager (registry)

export interface NotificationManagerOptions {
  /** Makes notifications link back to the decision. */
  appUrl?: string;
  /** Notifications older than this are never sent. Default 24. */
  maxAgeHours?: number;
  /** Backoff between retries, in minutes. Default [1, 5, 30, 120]. */
  retryDelaysMinutes?: readonly number[];
  /** Attempts before giving up. Default 5. */
  maxAttempts?: number;
}

export interface RunStats {
  planned: number;
  sent: number;
  failed: number;
  skipped: number;
  retrying: number;
}

export interface DeliverOptions {
  /** Restrict to these registered channels; default is every registered channel. */
  channels?: readonly ChannelName[];
}

export interface ChannelDelivery {
  channel: ChannelName;
  result: DeliveryResult;
}

export class NotificationManager {
  constructor(
    readonly log: DecisionLog,
    readonly options: NotificationManagerOptions = {},
  ) {}

  /** Names of the registered channels, in registration order. */
  get channelNames(): ChannelName[] {
    throw new NotImplementedError('NotificationManager.channelNames');
  }

  /** Adds a channel. Throws if it is not a NotificationChannel, has an invalid name, or the name is taken. */
  register(_channel: NotificationChannel): this {
    throw new NotImplementedError('NotificationManager.register');
  }

  /** One queue pass: plan new notifications, respect preferences, send what is due, schedule retries. Overlapping runs never double-send. */
  async run(): Promise<RunStats> {
    throw new NotImplementedError('NotificationManager.run');
  }

  /** One-shot delivery of an ad-hoc payload; not persisted, not retried. */
  async deliver(_input: NotificationPayloadInput, _options: DeliverOptions = {}): Promise<ChannelDelivery[]> {
    throw new NotImplementedError('NotificationManager.deliver');
  }
}

// ---------------------------------------------------------------- payloads

export const createNotificationPayload = (_input: NotificationPayloadInput): NotificationPayload => {
  throw new NotImplementedError('createNotificationPayload');
};

/** Every problem found, as `field: message` strings; empty when valid. */
export const validateNotificationPayload = (_input: unknown): string[] => {
  throw new NotImplementedError('validateNotificationPayload');
};

// ---------------------------------------------------------------- delivery results

export const sent = (_providerId?: string): DeliveryResult => {
  throw new NotImplementedError('sent');
};

export const failed = (_error: string, _options?: { retryable?: boolean }): DeliveryResult => {
  throw new NotImplementedError('failed');
};

export const skipped = (_reason: string): DeliveryResult => {
  throw new NotImplementedError('skipped');
};

export const isDeliveryResult = (_value: unknown): _value is DeliveryResult => {
  throw new NotImplementedError('isDeliveryResult');
};

// ---------------------------------------------------------------- conformance kit

export interface ChannelConformanceFixtures {
  /** A payload the channel must support and deliver. */
  payload: NotificationPayload;
  /** A payload without the channel's address; `supports` must return false. */
  unaddressable?: NotificationPayload;
}

/** Problems found with a channel implementation; empty when it conforms. */
export const checkChannelConformance = async (
  _channel: NotificationChannel,
  _fixtures: ChannelConformanceFixtures,
): Promise<string[]> => {
  throw new NotImplementedError('checkChannelConformance');
};
