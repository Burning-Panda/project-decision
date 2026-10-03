import { isDeliveryResult } from './payload.js';

export const CHANNEL_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Exercises the NotificationChannel contract. Returns a list of problems (empty = conforms).
 *   payload        a valid payload the channel should be able to deliver
 *   unaddressable  (optional) a valid payload lacking the address this channel needs; supports() must be false
 * Use it in your channel's tests against a stub/sandbox of the provider.
 */
export async function checkChannelConformance(channel, { payload, unaddressable } = {}) {
  const problems = [];
  let name;
  try { name = channel.name; } catch (e) { problems.push(`name getter threw: ${e.message}`); }
  if (typeof name !== 'string' || !CHANNEL_NAME.test(name)) problems.push(`name must match ${CHANNEL_NAME} (got ${JSON.stringify(name)})`);

  const check = (label, fn) => { try { return fn(); } catch (e) { problems.push(`${label} threw: ${e.message}`); return undefined; } };
  const supported = check('supports(payload)', () => channel.supports(payload));
  if (typeof supported !== 'boolean') problems.push(`supports() must return a boolean (got ${typeof supported})`);
  if (unaddressable) {
    const s = check('supports(unaddressable)', () => channel.supports(unaddressable));
    if (s !== false) problems.push('supports() must return false when the recipient has no usable address');
  }

  if (supported === true || (supported && typeof supported !== 'boolean')) {
    const before = JSON.stringify(payload);
    let result;
    try { result = await channel.send(payload); } catch (e) { problems.push(`send() should resolve with failed(...) rather than throw (threw: ${e.message})`); }
    if (result !== undefined && !isDeliveryResult(result)) problems.push(`send() returned an invalid delivery result: ${JSON.stringify(result)}`);
    if (JSON.stringify(payload) !== before) problems.push('send() must not modify the payload');
  }
  return problems;
}
