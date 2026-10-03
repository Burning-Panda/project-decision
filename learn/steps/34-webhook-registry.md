# 34 · Registering webhooks safely

## Goal

Register webhooks: admins only, a secret shown once, URLs and event filters validated, private targets refused.

## You'll learn

- Never returning secrets after creation
- Validating URLs against SSRF (private and loopback addresses)

## Where

- `src/decision-log/webhooks/webhooks.service.ts`
- New collection `webhooks` (ARRAY)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Store only `secret_enc` (encrypted with the secret box, bound to the webhook id); return the plaintext once from `create`.

### Hint 2

Reject non-http(s), credentials in the URL, localhost, private ranges, link-local and `.internal` hosts unless `allowPrivateTargets`.
