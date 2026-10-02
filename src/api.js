import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DecisionLogError, invalid, forbidden } from './errors.js';

const MAX_BODY = 1_000_000;
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const STATIC = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new DecisionLogError('PAYLOAD_TOO_LARGE', 'Request body too large', 413);
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new DecisionLogError('INVALID_JSON', 'Request body must be a JSON object', 400);
  }
}

/**
 * Builds the HTTP server. Authentication is a stand-in: the caller identity is taken from the
 * X-User header and must be replaced by real auth (session/JWT) before exposing this publicly.
 * `onMutation` is called after every successful non-GET request (used for persistence).
 */
export function createApp(log, { onMutation } = {}) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler });
  };
  const ok = (status, body) => ({ status, body: { success: true, status_code: status, ...body } });
  const me = (ctx, user) => (!user || user === 'me' ? ctx.actor : user);

  route('POST', '/owners', (c) => ok(201, { owner: log.createOwner({ ...c.body, identifier: c.body.identifier ?? c.actor }) }));
  route('POST', '/teams', (c) => ok(201, { team: log.createTeam({ ...c.body, actor: c.actor }) }));
  route('POST', '/teams/members', (c) => ok(201, { team: log.addTeamMember({ ...c.body, actor: c.actor }) }));
  route('POST', '/projects', (c) => ok(201, { project: log.createProject({ ...c.body, actor: c.actor }) }));
  route('GET', '/projects/:id', (c) => ok(200, { project: log.getProject(c.params.id) }));

  route('POST', '/decisions', (c) => ok(201, { decision: log.getDecision(log.createDecision({ ...c.body, actor: c.actor }).id, c.actor) }));
  route('GET', '/decisions', (c) => ok(200, log.listDecisions({ ...c.query, actor: c.actor })));
  route('GET', '/decisions/:id', (c) => ok(200, { decision: log.getDecision(c.params.id, c.actor) }));
  route('GET', '/decisions/:id/document', (c) => ({ status: 200, text: log.renderDecisionDocument(c.params.id, c.actor) }));
  route('POST', '/decisions/:id/actions', (c) => {
    if (typeof c.body.action !== 'string' || !c.body.action) throw invalid('action is required');
    c.action = c.body.action;
    const result = log.perform(c.params.id, c.actor, c.body, { idempotencyKey: c.idempotencyKey, ip: c.ip });
    return { status: result.status_code, body: result };
  });
  route('GET', '/decisions/:id/versions', (c) => {
    const versions = log.getVersions(c.params.id, c.actor);
    const limit = Math.min(100, Math.max(1, Number.parseInt(c.query.limit, 10) || 25));
    return ok(200, { versions: versions.slice(0, limit), total: versions.length });
  });
  route('GET', '/decisions/:id/diff', (c) => ok(200, { diff: log.diff(c.params.id, c.actor, c.query) }));
  route('GET', '/decisions/:id/comments', (c) => ok(200, { comments: log.listComments(c.params.id, c.actor) }));
  route('POST', '/decisions/:id/comments', (c) => ok(201, { comment: log.addComment(c.params.id, c.actor, c.body) }));
  route('GET', '/decisions/:id/participants', (c) => ok(200, { participants: log.getParticipants(c.params.id, c.actor) }));
  route('GET', '/decisions/:id/related', (c) => ok(200, { related: log.getRelated(c.params.id, c.actor) }));
  route('GET', '/decisions/:id/integrity', (c) => { log.getDecision(c.params.id, c.actor); return ok(200, { integrity: log.verifyIntegrity(c.params.id) }); });

  route('GET', '/todos', (c) => {
    const user = me(c, c.query.user);
    if (user !== c.actor && !log.store.owners.has(c.actor)) throw forbidden('You can only list your own todos');
    return ok(200, log.listTodos({ ...c.query, user }));
  });
  route('PATCH', '/todos/:id', (c) => ok(200, { todo: log.updateTodo(c.params.id, c.actor, c.body) }));

  route('POST', '/webhooks', (c) => ok(201, { webhook: log.createWebhook({ ...c.body, actor: c.actor }) }));
  route('GET', '/webhooks', (c) => ok(200, { webhooks: log.listWebhooks(c.query.owner, c.actor) }));
  route('DELETE', '/webhooks/:id', (c) => ok(200, { webhook: log.deleteWebhook(c.params.id, c.actor) }));
  route('GET', '/webhooks/:id/deliveries', (c) => ok(200, log.listDeliveries(c.params.id, c.actor, c.query)));
  route('POST', '/deliveries/:id/redeliver', (c) => ok(200, { delivery: log.redeliver(c.params.id, c.actor) }));

  route('GET', '/profile', (c) => ok(200, { profile: log.getProfile(me(c, c.query.user), c.actor) }));
  route('PUT', '/profile', (c) => ok(200, { profile: log.setProfile(me(c, c.query.user), c.actor, c.body) }));

  route('GET', '/search', (c) => ok(200, log.search({ ...c.query, actor: c.actor })));
  route('GET', '/dashboard', (c) => ok(200, { dashboard: log.dashboard(c.actor) }));
  route('GET', '/notifications', (c) => ok(200, { notifications: log.listNotifications(c.actor) }));
  route('GET', '/reports/:type', (c) => ok(200, { report: log.report(c.params.type, { ...c.query, actor: c.actor }) }));
  route('GET', '/export', (c) => {
    const out = log.exportDecisions({ actor: c.actor, format: c.query.format ?? 'json' });
    return typeof out === 'string' ? { status: 200, text: out, type: 'text/csv' } : ok(200, { decisions: out });
  });

  const errorBody = (e, action) => {
    const known = e instanceof DecisionLogError;
    const status = known ? e.status : 500;
    return {
      status,
      body: {
        success: false,
        status_code: status,
        ...(action ? { action_attempted: action } : {}),
        error: known ? { code: e.code, message: e.message, ...e.details } : { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        timestamp: new Date().toISOString(),
      },
    };
  };

  return http.createServer(async (req, res) => {
    const ctx = { action: null };
    const send = ({ status, body, text, type }) => {
      const headers = { 'request-date': new Date().toISOString() };
      if (ctx.idempotencyKey) headers['idempotency-key'] = ctx.idempotencyKey;
      if (text !== undefined) {
        res.writeHead(status, { ...headers, 'content-type': `${type ?? 'text/markdown'}; charset=utf-8` });
        res.end(text);
      } else {
        res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      }
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const asset = req.method === 'GET' ? STATIC[url.pathname] : undefined;
      if (asset) {
        res.writeHead(200, { 'content-type': `${asset[1]}; charset=utf-8`, 'x-content-type-options': 'nosniff' });
        res.end(fs.readFileSync(PUBLIC_DIR + asset[0]));
        return;
      }
      const match = routes
        .filter((r) => r.re.test(url.pathname))
        .find((r) => r.method === req.method);
      if (!match) {
        const pathExists = routes.some((r) => r.re.test(url.pathname));
        throw new DecisionLogError(pathExists ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', pathExists ? 'Method not allowed' : 'Route not found', pathExists ? 405 : 404);
      }
      ctx.idempotencyKey = req.headers['idempotency-key'] || null;
      ctx.actor = req.headers['x-user'];
      if (!ctx.actor) throw new DecisionLogError('UNAUTHENTICATED', 'X-User header is required', 401);
      const m = match.re.exec(url.pathname);
      ctx.params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      ctx.query = Object.fromEntries(url.searchParams);
      ctx.ip = req.socket.remoteAddress;
      ctx.body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJson(req) : {};
      const out = await match.handler(ctx);
      if (req.method !== 'GET') onMutation?.();
      send(out);
    } catch (e) {
      if (!(e instanceof DecisionLogError)) console.error(e);
      send(errorBody(e, ctx.action));
    }
  });
}

