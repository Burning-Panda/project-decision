# 02 · Worked example: the email channel and SMTP

## Goal

A second worked example with real I/O: `src/notifications/email.ts` renders and sends email; its spec talks to a real (local, fake) SMTP server.

## You'll learn

- Escaping untrusted text for HTML and headers
- Mapping external errors onto your own result types (retryable or permanent)
- Testing network code against a local server (`test/support/mock-smtp.ts`)

## Where

- `src/notifications/email.ts`
- `test/notifications/email.spec.ts` (the first four sections)
- `test/support/mock-smtp.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Follow one email from `EmailChannel.send` to the mock server's `sessions` and match it to the spec's THEN.

### Hint 2

Why is the Message-ID derived from the notification id? Find the THEN that needs it.
