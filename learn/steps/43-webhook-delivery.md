# 43 · Delivering webhooks: signing, retries, SSRF

## Goal

Deliver webhooks: signed POSTs, exponential backoff, five attempts, redelivery, cancellation, no double sends, and refusing private targets at delivery time.

## You'll learn

- HMAC signatures with timestamps
- Retry with backoff
- Concurrency guards
- SSRF checks after DNS resolution

## Where

- `src/webhooks/dispatcher.ts`
- `src/decision-log/webhooks/webhooks.service.ts`
- `src/webhooks/webhooks.controller.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Signature: HMAC-SHA256 of `` `${timestamp}.${body}` `` with the decrypted secret, sent as `sha256=<hex>`; verify with a constant-time compare and a 5-minute tolerance.

### Hint 2

Backoff after attempt 1, 2, … : 1 min, 5 min, 30 min, 2 h, then failed after 5 attempts.

### Hint 3

Resolve the hostname and refuse if any address is private, loopback or link-local, including IPv4-mapped IPv6.

### Hint 4

Mark rows in-flight before awaiting the network, so an overlapping run skips them.
