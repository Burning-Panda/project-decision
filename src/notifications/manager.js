import { createNotificationPayload, isDeliveryResult, failed, skipped } from './payload.js';
import { NotificationChannel } from './channel.js';
import { CHANNEL_NAME } from './conformance.js';
import { MAX_ATTEMPTS, BACKOFF_SECONDS } from '../webhooks.js';
import { pad } from '../util.js';

const TITLES = {
  decision_proposed: 'Decision proposed for review',
  vote_received: 'New vote on your decision',
  mention: 'You were mentioned',
  followup_assigned: 'New follow-up assigned to you',
  decision_declined: 'Decision declined',
  decision_approved: 'Decision approved',
  revision_requested: 'Revision requested',
  related_decision: 'A related decision was created',
};
const HIGH = new Set(['mention', 'followup_assigned', 'revision_requested', 'decision_declined']);
const LOW = new Set(['vote_received', 'related_decision']);

/**
 * Turns the log's in-app notifications into standard payloads and delivers them through every registered
 * channel the recipient has enabled, with per-channel retries, optional fallback order and persistence of
 * every attempt (so a restart never re-sends or loses anything). Call run() on a timer.
 *
 * Other services can also push ad-hoc payloads through the same channels with deliver().
 */
export class NotificationManager {
  constructor(log, { channels = [], appUrl = null, batch = 100 } = {}) {
    Object.assign(this, { log, appUrl: appUrl ? appUrl.replace(/\/+$/, '') : null, batch, running: false });
    this.registry = new Map();
    for (const c of channels) this.register(c);
  }

  register(channel) {
    if (!(channel instanceof NotificationChannel)) throw new Error('channel must extend NotificationChannel');
    const name = channel.name;
    if (typeof name !== 'string' || !CHANNEL_NAME.test(name)) throw new Error(`invalid channel name ${JSON.stringify(name)}`);
    if (this.registry.has(name)) throw new Error(`channel "${name}" is already registered`);
    this.registry.set(name, channel);
    return this;
  }

  get channelNames() { return [...this.registry.keys()]; }

  buildPayload(n) {
    const profile = this.log._profileOf(n.user);
    const decision = n.decision_id ? this.log.store.decisions.get(n.decision_id) : null;
    const title = TITLES[n.type] ?? n.type;
    return createNotificationPayload({
      id: n.id,
      type: n.type,
      priority: HIGH.has(n.type) ? 'high' : LOW.has(n.type) ? 'low' : 'normal',
      recipient: { user: n.user, email: profile.email, phone: profile.phone, push_tokens: profile.push_tokens },
      content: {
        title: n.decision_id ? `[${n.decision_id}] ${title}` : title,
        body: n.message,
        link: this.appUrl && n.decision_id ? `${this.appUrl}/#/d/${n.decision_id}` : null,
      },
      context: { decision_id: n.decision_id ?? null, project: decision?.project ?? null, actor: n.actor ?? null },
      created_at: n.created_at,
    });
  }

  async run() {
    const stats = { planned: 0, sent: 0, failed: 0, skipped: 0, retrying: 0 };
    if (this.running) return stats;
    this.running = true;
    try {
      this.plan(stats);
      await this.process(stats);
    } finally {
      this.running = false;
    }
    return stats;
  }

  plan(stats) {
    const { store } = this.log;
    const now = this.log.clock().toISOString();
    for (const n of store.notifications.filter((x) => !x.planned).slice(0, this.batch)) {
      n.planned = true;
      stats.planned++;
      const prefs = this.log._profileOf(n.user).preferences;
      if (prefs.muted_types.includes(n.type)) continue;
      const payload = this.buildPayload(n);
      let previous = null;
      for (const name of prefs.order) {
        const channel = this.registry.get(name);
        if (!channel || prefs.channels[name] !== true) continue;
        const row = {
          id: `cdl-${pad(store.next('channel_delivery'))}`, notification_id: n.id, channel: name, status: 'pending', attempts: 0,
          next_attempt_at: now, last_error: null, provider_id: null, sent_at: null, created_at: now,
          depends_on: prefs.mode === 'fallback' ? previous : null,
        };
        if (!channel.supports(payload)) { row.status = 'skipped'; row.last_error = 'no_address'; stats.skipped++; }
        store.channel_deliveries.push(row);
        previous = row.id;
      }
    }
  }

  /** 'sent' | 'wait' | 'go' for a fallback row, looking through the whole chain of earlier channels. */
  chainState(row, byId) {
    for (let id = row.depends_on; id; id = byId.get(id)?.depends_on) {
      const dep = byId.get(id);
      if (!dep) break;
      if (dep.status === 'sent') return 'sent';
      if (dep.status === 'pending') return 'wait';
    }
    return 'go';
  }

  async process(stats) {
    const { store } = this.log;
    const now = this.log.clock();
    const nowIso = now.toISOString();
    const byId = new Map(store.channel_deliveries.map((d) => [d.id, d]));
    const notifications = new Map(store.notifications.map((n) => [n.id, n]));
    const due = store.channel_deliveries.filter((d) => d.status === 'pending' && d.next_attempt_at <= nowIso).slice(0, this.batch);

    for (const row of due) {
      if (row.depends_on) {
        const state = this.chainState(row, byId);
        if (state === 'wait') continue;
        if (state === 'sent') { Object.assign(row, { status: 'skipped', last_error: 'fallback_not_needed' }); stats.skipped++; continue; }
      }
      const channel = this.registry.get(row.channel);
      const n = notifications.get(row.notification_id);
      if (!channel || !n) { Object.assign(row, { status: 'failed', last_error: channel ? 'notification_missing' : 'channel_not_registered' }); stats.failed++; continue; }

      row.attempts += 1;
      let result;
      try {
        result = await channel.send(this.buildPayload(n));
        if (!isDeliveryResult(result)) result = failed(`invalid delivery result from channel "${row.channel}"`);
      } catch (e) {
        result = failed(e.message);
      }
      this.apply(row, result, now, stats);
    }
  }

  apply(row, result, now, stats) {
    if (result.status === 'sent') {
      Object.assign(row, { status: 'sent', provider_id: result.provider_id ?? null, last_error: null, sent_at: now.toISOString() });
      stats.sent++;
    } else if (result.status === 'skipped') {
      Object.assign(row, { status: 'skipped', last_error: result.reason });
      stats.skipped++;
    } else {
      row.last_error = result.error;
      if (!result.retryable || row.attempts >= MAX_ATTEMPTS) { row.status = 'failed'; stats.failed++; }
      else { row.next_attempt_at = new Date(now.getTime() + BACKOFF_SECONDS[row.attempts - 1] * 1000).toISOString(); stats.retrying++; }
    }
  }

  /**
   * One-shot delivery of an ad-hoc payload (not queued, not retried, not persisted). For other services that
   * want to reuse the channels. Resolves with [{ channel, result }] in registration order.
   */
  async deliver(input, { channels } = {}) {
    const payload = createNotificationPayload(input);
    const names = channels ?? this.channelNames;
    for (const n of names) if (!this.registry.has(n)) throw new Error(`channel "${n}" is not registered`);
    const out = [];
    for (const name of names) {
      const channel = this.registry.get(name);
      let result;
      if (!channel.supports(payload)) result = skipped('no_address');
      else {
        try {
          result = await channel.send(payload);
          if (!isDeliveryResult(result)) result = failed(`invalid delivery result from channel "${name}"`);
        } catch (e) { result = failed(e.message); }
      }
      out.push({ channel: name, result });
    }
    return out;
  }
}
