import { DecisionLogError } from '../errors.js';
import { isValidEmail } from '../util.js';

export const PAYLOAD_VERSION = 1;
export const PRIORITIES = ['low', 'normal', 'high'];
export const MAX_TITLE = 200;
export const MAX_BODY = 10_000;
export const MAX_PUSH_TOKENS = 10;

/**
 * The standard, channel-agnostic notification. Every channel receives exactly this shape (frozen),
 * so a new channel never needs to know where a notification came from.
 *
 * {
 *   version: 1,
 *   id: string,                     unique notification id (stable across retries)
 *   type: string,                   machine name, e.g. "decision_proposed"
 *   priority: "low"|"normal"|"high",
 *   recipient: { user, email|null, phone|null (E.164), push_tokens: string[] },
 *   content:   { title, body (plain text), html|null, link (http/https)|null },
 *   context:   { decision_id|null, project|null, actor|null },
 *   data: object,                   small JSON-safe extras for channels that want them
 *   created_at: ISO-8601,
 *   dedupe_key: string              receivers/providers can use it to suppress duplicates
 * }
 */
export function normalizePayload(input = {}) {
  const r = input.recipient ?? {};
  const c = input.content ?? {};
  const x = input.context ?? {};
  return {
    version: input.version ?? PAYLOAD_VERSION,
    id: input.id,
    type: input.type,
    priority: input.priority ?? 'normal',
    recipient: { user: r.user, email: r.email ?? null, phone: r.phone ?? null, push_tokens: r.push_tokens ?? [] },
    content: { title: c.title, body: c.body, html: c.html ?? null, link: c.link ?? null },
    context: { decision_id: x.decision_id ?? null, project: x.project ?? null, actor: x.actor ?? null },
    data: input.data ?? {},
    created_at: input.created_at ?? new Date().toISOString(),
    dedupe_key: input.dedupe_key ?? input.id,
  };
}

const nonEmpty = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;

function jsonSafe(v, depth = 0) {
  if (depth > 8) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => jsonSafe(x, depth + 1));
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.values(v).every((x) => jsonSafe(x, depth + 1));
  return false;
}

/** Returns a list of human-readable problems (empty when valid). Each starts with the offending field path. */
export function validateNotificationPayload(input) {
  const p = normalizePayload(input);
  const errors = [];
  if (p.version !== PAYLOAD_VERSION) errors.push(`version must be ${PAYLOAD_VERSION}`);
  if (!nonEmpty(p.id, 100)) errors.push('id is required (max 100 characters)');
  if (typeof p.type !== 'string' || !/^[a-z][a-z0-9_.]*$/.test(p.type)) errors.push('type must be a lower_snake_case string');
  if (!PRIORITIES.includes(p.priority)) errors.push(`priority must be one of ${PRIORITIES.join(', ')}`);
  if (!nonEmpty(p.recipient.user, 320)) errors.push('recipient.user is required');
  if (p.recipient.email !== null && !isValidEmail(p.recipient.email)) errors.push('recipient.email is not a valid address');
  if (p.recipient.phone !== null && !(typeof p.recipient.phone === 'string' && /^\+[1-9]\d{6,14}$/.test(p.recipient.phone))) errors.push('recipient.phone must be E.164 (+14155550123)');
  const tokens = p.recipient.push_tokens;
  if (!Array.isArray(tokens) || tokens.length > MAX_PUSH_TOKENS || !tokens.every((t) => nonEmpty(t, 512))) errors.push(`recipient.push_tokens must be a list of up to ${MAX_PUSH_TOKENS} non-empty strings`);
  if (!nonEmpty(p.content.title, MAX_TITLE)) errors.push(`content.title is required (max ${MAX_TITLE} characters)`);
  if (!nonEmpty(p.content.body, MAX_BODY)) errors.push(`content.body is required (max ${MAX_BODY} characters)`);
  if (p.content.html !== null && typeof p.content.html !== 'string') errors.push('content.html must be a string or null');
  if (p.content.link !== null && !/^https?:\/\/[^\s]+$/i.test(String(p.content.link))) errors.push('content.link must be an http(s) URL');
  if (!jsonSafe(p.data) || JSON.stringify(p.data).length > 16_384) errors.push('data must be small, JSON-safe plain data');
  if (Number.isNaN(Date.parse(p.created_at))) errors.push('created_at must be an ISO-8601 timestamp');
  return errors;
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

export function createNotificationPayload(input) {
  const errors = validateNotificationPayload(input);
  if (errors.length) throw new DecisionLogError('VALIDATION_ERROR', `Invalid notification payload: ${errors.join('; ')}`, 400, { errors });
  return deepFreeze(structuredClone(normalizePayload(input)));
}

// ---------------------------------------------------------------- delivery results
/** What NotificationChannel.send() resolves with. */
export const sent = (providerId) => (providerId === undefined ? { status: 'sent' } : { status: 'sent', provider_id: String(providerId) });
export const failed = (error, { retryable = true } = {}) => ({ status: 'failed', error: String(error), retryable });
export const skipped = (reason) => ({ status: 'skipped', reason: String(reason) });

export function isDeliveryResult(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.status === 'sent') return r.provider_id === undefined || typeof r.provider_id === 'string';
  if (r.status === 'failed') return typeof r.error === 'string' && typeof r.retryable === 'boolean';
  if (r.status === 'skipped') return typeof r.reason === 'string';
  return false;
}
