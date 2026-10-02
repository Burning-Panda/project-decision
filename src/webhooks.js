import { createHmac, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { isPrivateAddress } from './net.js';

export const EVENT_TYPES = [
  'decision.created', 'decision.proposed', 'decision.vote_received', 'decision.approved', 'decision.declined',
  'decision.revision_requested', 'decision.returned_to_draft', 'decision.superseded',
  'comment.created', 'followup.assigned', 'followup.completed', 'meeting.recorded',
];
const FAMILIES = new Set(EVENT_TYPES.map((t) => t.split('.')[0]));

export const isValidEventPattern = (p) => p === '*' || EVENT_TYPES.includes(p) || (p.endsWith('.*') && FAMILIES.has(p.slice(0, -2)));
export const matchesEvent = (patterns, type) => patterns.some((p) => p === '*' || p === type || (p.endsWith('.*') && type.startsWith(p.slice(0, -1))));

export const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 1800, 7200]; // delay after the 1st..4th failure

const sign = (secret, timestamp, body) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/**
 * Receiver-side helper. The signature header is `sha256=<hex hmac of "<timestamp>.<body>">`.
 * Rejects bad signatures and timestamps outside the tolerance (replay protection).
 */
export function verifySignature({ secret, timestamp, body, signature, now = new Date(), toleranceSeconds = 300 }) {
  if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, timestamp, body), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

const defaultTransport = (url, init) => fetch(url, init);
const defaultResolve = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);

/**
 * Delivers pending outbox deliveries. Call run() on a timer. Redirects are never followed, and hosts
 * that resolve to private addresses are refused (SSRF). Note: the check resolves DNS separately from the
 * request, so run behind an egress proxy/firewall if you need protection against DNS rebinding.
 */
export class WebhookDispatcher {
  constructor(log, { transport = defaultTransport, resolve = defaultResolve, allowPrivateTargets = false, timeoutMs = 5000, batch = 50 } = {}) {
    Object.assign(this, { log, transport, resolve, allowPrivateTargets, timeoutMs, batch, running: false });
  }

  async run() {
    const stats = { attempted: 0, delivered: 0, failed: 0, retrying: 0 };
    if (this.running) return stats;
    this.running = true;
    try {
      const { store } = this.log;
      const now = this.log.clock();
      const nowIso = now.toISOString();
      const webhooks = new Map(store.webhooks.map((w) => [w.id, w]));
      const events = new Map(store.events.map((e) => [e.id, e]));
      const due = store.deliveries.filter((d) => d.status === 'pending' && d.next_attempt_at <= nowIso).slice(0, this.batch);
      for (const delivery of due) {
        const hook = webhooks.get(delivery.webhook_id);
        const event = events.get(delivery.event_id);
        if (!hook || !hook.active || !event) { delivery.status = 'cancelled'; continue; }
        stats.attempted++;
        const outcome = await this.attempt(hook, event, delivery, now);
        stats[outcome]++;
      }
    } finally {
      this.running = false;
    }
    return stats;
  }

  async attempt(hook, event, delivery, now) {
    delivery.attempts += 1;
    delivery.last_attempt_at = now.toISOString();
    const fail = (error, status = null, retry = true) => {
      delivery.last_status = status;
      delivery.last_error = error;
      if (!retry || delivery.attempts >= MAX_ATTEMPTS) { delivery.status = 'failed'; return 'failed'; }
      delivery.next_attempt_at = new Date(now.getTime() + BACKOFF_SECONDS[delivery.attempts - 1] * 1000).toISOString();
      return 'retrying';
    };

    const host = new URL(hook.url).hostname.replace(/^\[|\]$/g, '');
    let addresses;
    try { addresses = net.isIP(host) ? [host] : await this.resolve(host); } catch (e) { return fail(`dns: ${e.message}`); }
    if (!this.allowPrivateTargets && (!addresses.length || addresses.some(isPrivateAddress))) return fail('blocked_target', null, false);

    let secret;
    try { secret = this.log.webhookSecret(hook); } catch { return fail('secret_unavailable', null, false); }
    const body = JSON.stringify(event.payload);
    const timestamp = String(Math.floor(now.getTime() / 1000));
    try {
      const res = await this.transport(hook.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
        body,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'decision-log-webhooks/1',
          'x-decision-log-event': event.type,
          'x-decision-log-delivery': delivery.id,
          'x-decision-log-timestamp': timestamp,
          'x-decision-log-signature': `sha256=${sign(secret, timestamp, body)}`,
        },
      });
      if (res.status >= 200 && res.status < 300) {
        Object.assign(delivery, { status: 'delivered', last_status: res.status, last_error: null, delivered_at: now.toISOString() });
        return 'delivered';
      }
      return fail(`http_${res.status}`, res.status);
    } catch (e) {
      return fail(e.message);
    }
  }
}
