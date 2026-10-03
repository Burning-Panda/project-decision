# 40 · Controllers: decisions over HTTP

## Goal

Expose decisions over HTTP: create, fetch and the action endpoint. The error filter and interceptors already exist.

## You'll learn

- Thin controllers that delegate to the domain
- Status codes from the domain result

## Where

- `src/decisions/decisions.controller.ts`
- `src/api/` (filter, interceptors: already implemented, read them)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Controllers get the caller from `req.actor` (set by `XUserGuard`) and the log via the API options.

### Hint 2

Respond with the domain result in an envelope (`{ decision }`, or the action envelope as is) and set the status from `status_code`.
