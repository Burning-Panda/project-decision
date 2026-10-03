# 03 · Your first fix: serve the UI script

## Goal

The web page loads a script from `/app.js`, but that request returns 404. Find out why and fix it. This step walks you through the whole loop once: read the failure, find the code, change it, run again.

## You'll learn

- Reading a failing test and its output (see `learn/concepts/reading-test-output.md`)
- How a Nest controller maps a URL path to a function (`@Get('path')`), and what status codes mean → `learn/concepts/http-basics.md`
- The loop you will repeat in every step: red → change → green

## Where

- `src/ui/ui.controller.ts`
- The file it should serve: `public/app.js`

## Walkthrough

1. Run `bun run learn`. Read the last line of the failure: `WHEN GET /app.js > THEN 200 with javascript`. A browser asks for `/app.js` and should get the script.
2. Read `Expected: 200 / Received: 404`. 404 means no route matched the path.
3. Open `src/ui/ui.controller.ts`. Each `@Get('...')` above a function is a path the server answers. Compare them with `/app.js`.
4. Look at what the `script` function sends: `PUBLIC_DIR + '...'`. Compare that name with the files in `public/`.
5. Make your change, save, and run `bun run learn` again. When the step is done it moves you to step 04.

## Hints

### Section: the web UI assets are public and whitelisted

#### What the test wants
`GET /app.js` must answer 200 with a JavaScript content type, so the page can load its script. The other assets (`/`, `/style.css`, `/favicon.ico`) already work.

#### Where to look
`src/ui/ui.controller.ts`, the `script` function and the decorator directly above it. Two strings there decide which URL is answered and which file is sent.

#### Plan
1. Make the decorator's path match the URL the browser requests.
2. Make the file name match the real file in `public/`.

#### Almost the answer
```ts
@Get('app.js')          // the URL path, without the leading slash
script(@Res() res: Response) {
  return sendAsset(res, PUBLIC_DIR + '____', 'text/javascript');   // the file name in public/
}
```

## Common mistakes

- Changing only one of the two strings: the route and the file name must both say `app.js`.
- Adding a leading slash inside `@Get('/app.js')` is fine, but the file name must not get one (`PUBLIC_DIR` already ends with `/`).
