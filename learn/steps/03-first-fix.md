# 03 · Your first fix: serve the UI script

## Goal

The web page loads a script from `/app.js`, but that request returns 404. Find out why and fix it.

## You'll learn

- Reading a failing test and the code it exercises
- How a Nest controller maps a URL path to a handler

## Where

- `src/ui/ui.controller.ts`
- The file it should serve: `public/app.js`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

The failing test requests `GET /app.js` and expects 200 with a JavaScript content type.

### Hint 2

Compare the path in each `@Get(...)` with the path the test requests, and the file name each handler sends with the files in `public/`.

### Hint 3

Two strings in the `script` handler are missing `.js`.
