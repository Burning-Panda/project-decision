import { NotImplementedError } from '../../common/errors';
import type { Notifier } from '../../notifications/index';
import type { DecisionLog } from '../decision-log';
import type { RetryPolicy } from './retry-policy';

export interface NotificationDispatcherOptions {
  /** Makes notifications link back to the decision. */
  appUrl?: string;
  /** Notifications older than this are never sent. Default 24. */
  maxAgeHours?: number;
  /** Default: 1m, 5m, 30m, 2h, then give up after 5 attempts. */
  retry?: RetryPolicy;
}

export interface DispatchStats {
  planned: number;
  sent: number;
  failed: number;
  skipped: number;
  retrying: number;
}

/**
 * Project-side glue: turns the log's in-app notifications and user profiles into `Notifier.send` calls, and owns
 * persistence, retries with backoff and the backlog cutoff. Kept out of the notifications module on purpose.
 *
 * Payload mapping: `recipient.addresses` is `{ email: [profile.email], sms: [profile.phone], push: profile.push_subscriptions
 * as JSON strings }` (empty entries left out); `data` is `{ decision_id, project, actor }`.
 */
export class NotificationDispatcher {
  constructor(
    readonly log: DecisionLog,
    readonly notifier: Notifier,
    readonly options: NotificationDispatcherOptions = {},
  ) {}

  /** One queue pass: plan new notifications, send what is due, schedule retries. Overlapping runs never double-send. */
  async run(): Promise<DispatchStats> {
    throw new NotImplementedError('NotificationDispatcher.run');
  }
}
