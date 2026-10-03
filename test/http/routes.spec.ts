import { describe, it, expect, beforeEach } from 'bun:test';
import { buildLog, startApi, makeCaller } from '../support/index';
import { ROUTES, PUBLIC_ASSETS } from '../support/routes';

// Routing is resolved BEFORE authentication, so these checks need no users, data or domain logic:
//   registered route + no X-User        -> 401 UNAUTHENTICATED
//   known path + unregistered method    -> 405 METHOD_NOT_ALLOWED
//   unknown path                        -> 404 NOT_FOUND
//
// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Every THEN therefore runs against a freshly built API.
type Caller = ReturnType<typeof makeCaller>;
type Reply = Awaited<ReturnType<Caller>>;

/** Registers a beforeEach that boots an API on a free port and exposes it through the returned handle. */
function runningApi() {
  const api = {} as { base: string; call: Caller };
  beforeEach(async () => {
    const { base } = await startApi(await buildLog({}));
    api.base = base;
    api.call = makeCaller(base);
  });
  return api;
}

describe('every route is registered', () => {
  for (const { method, example } of ROUTES) {
    describe('GIVEN a running API', () => {
      const api = runningApi();

      describe(`WHEN ${method} ${example} is called without credentials`, () => {
        let reply: Reply;
        beforeEach(async () => { reply = await api.call(method, example); });

        it('THEN 401 UNAUTHENTICATED (the route exists)', () => {
          expect(reply.status).toBe(401);
          expect(reply.json.success).toBe(false);
          expect(reply.json.error.code).toBe('UNAUTHENTICATED');
        });
      });
    });
  }
});

describe('an empty X-User is the same as none', () => {
  for (const [label, value] of [['empty', ''], ['whitespace-only', '   ']]) {
    describe('GIVEN a running API', () => {
      const api = runningApi();

      describe(`WHEN GET /decisions is sent with an ${label} X-User`, () => {
        let reply: Reply;
        beforeEach(async () => { reply = await api.call('GET', '/decisions', { headers: { 'x-user': value } }); });

        it('THEN 401 UNAUTHENTICATED', () => {
          expect(reply.status).toBe(401);
          expect(reply.json.error.code).toBe('UNAUTHENTICATED');
        });
      });
    });
  }
});

describe('known paths reject methods that are not registered for them', () => {
  const ALL = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const byPattern = new Map<string, { example: string; methods: Set<string> }>();
  for (const r of ROUTES) {
    const entry = byPattern.get(r.pattern) ?? { example: r.example, methods: new Set<string>() };
    entry.methods.add(r.method);
    byPattern.set(r.pattern, entry);
  }

  for (const [pattern, { example, methods }] of byPattern) {
    const wrong = ALL.find((m) => !methods.has(m))!;
    describe(`GIVEN ${pattern} is registered for ${[...methods].join('/')}`, () => {
      const api = runningApi();

      describe(`WHEN ${wrong} ${example} is called`, () => {
        let reply: Reply;
        beforeEach(async () => { reply = await api.call(wrong, example); });

        it('THEN 405 METHOD_NOT_ALLOWED', () => {
          expect(reply.status).toBe(405);
          expect(reply.json.error.code).toBe('METHOD_NOT_ALLOWED');
        });
      });
    });
  }
});

describe('unknown paths are not routed', () => {
  const unknown = ['/nope', '/decisions/PRJ-001/unknown', '/decisions/PRJ-001/actions/extra', '/webhooks/webhook-001/unknown', '/api/decisions'];
  for (const path of unknown) {
    describe('GIVEN a running API', () => {
      const api = runningApi();

      describe(`WHEN GET ${path} is called`, () => {
        let reply: Reply;
        beforeEach(async () => { reply = await api.call('GET', path); });

        it('THEN 404 NOT_FOUND before authentication is considered', () => {
          expect(reply.status).toBe(404);
          expect(reply.json.error.code).toBe('NOT_FOUND');
        });
      });
    });
  }
});

describe('the web UI assets are public and whitelisted', () => {
  for (const { path, status, type } of PUBLIC_ASSETS) {
    describe('GIVEN no credentials', () => {
      const api = runningApi();

      describe(`WHEN GET ${path}`, () => {
        let res: Response;
        beforeEach(async () => { res = await fetch(`${api.base}${path}`); });

        it(`THEN ${status}${type ? ` with ${type.source}` : ''}`, () => {
          expect(res.status).toBe(status);
          if (type) expect(res.headers.get('content-type')).toMatch(type);
        });
      });
    });
  }

  describe('GIVEN no credentials', () => {
    const api = runningApi();

    describe('WHEN a static asset is requested with a non-GET method', () => {
      let res: Response;
      beforeEach(async () => { res = await fetch(`${api.base}/app.js`, { method: 'POST' }); });

      it('THEN it is not served', () => {
        expect(res.status).not.toBe(200);
      });
    });
  });

  describe('GIVEN no credentials', () => {
    const api = runningApi();

    describe('WHEN GET / is read', () => {
      let body: string;
      beforeEach(async () => { body = await (await fetch(`${api.base}/`)).text(); });

      it('THEN the page is titled Decision Log', () => {
        expect(body).toMatch(/Decision Log/);
      });
    });
  });

  const notWhitelisted: Array<[string, string]> = [
    ['a path traversal', '/..%2Fpackage.json'],
    ['a file that exists but is not whitelisted', '/index.html'],
  ];
  for (const [label, path] of notWhitelisted) {
    describe('GIVEN no credentials', () => {
      const api = runningApi();

      describe(`WHEN ${label} (GET ${path}) is requested`, () => {
        let res: Response;
        beforeEach(async () => { res = await fetch(`${api.base}${path}`); });

        it('THEN 404', () => {
          expect(res.status).toBe(404);
        });
      });
    });
  }
});

describe('the route table is complete', () => {
  describe('GIVEN the route list', () => {
    let keys: string[];
    beforeEach(() => { keys = ROUTES.map((r) => `${r.method} ${r.pattern}`); });

    describe('WHEN checked for duplicates', () => {
      let unique: number;
      beforeEach(() => { unique = new Set(keys).size; });

      it('THEN every method + pattern is unique', () => {
        expect(unique).toBe(keys.length);
      });
    });
  });
});
