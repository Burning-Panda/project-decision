/** The complete HTTP route table. `example` is a concrete path matching `pattern`. */
export interface RouteSpec { method: string; pattern: string; example: string }

export const ROUTES: RouteSpec[] = [
  { method: 'POST', pattern: '/owners', example: '/owners' },
  { method: 'POST', pattern: '/teams', example: '/teams' },
  { method: 'POST', pattern: '/teams/members', example: '/teams/members' },
  { method: 'POST', pattern: '/projects', example: '/projects' },
  { method: 'GET', pattern: '/projects/:id', example: '/projects/PRJ' },

  { method: 'POST', pattern: '/decisions', example: '/decisions' },
  { method: 'GET', pattern: '/decisions', example: '/decisions' },
  { method: 'GET', pattern: '/decisions/:id', example: '/decisions/PRJ-001' },
  { method: 'GET', pattern: '/decisions/:id/document', example: '/decisions/PRJ-001/document' },
  { method: 'POST', pattern: '/decisions/:id/actions', example: '/decisions/PRJ-001/actions' },
  { method: 'GET', pattern: '/decisions/:id/versions', example: '/decisions/PRJ-001/versions' },
  { method: 'GET', pattern: '/decisions/:id/diff', example: '/decisions/PRJ-001/diff' },
  { method: 'GET', pattern: '/decisions/:id/comments', example: '/decisions/PRJ-001/comments' },
  { method: 'POST', pattern: '/decisions/:id/comments', example: '/decisions/PRJ-001/comments' },
  { method: 'GET', pattern: '/decisions/:id/participants', example: '/decisions/PRJ-001/participants' },
  { method: 'GET', pattern: '/decisions/:id/related', example: '/decisions/PRJ-001/related' },
  { method: 'GET', pattern: '/decisions/:id/integrity', example: '/decisions/PRJ-001/integrity' },

  { method: 'GET', pattern: '/todos', example: '/todos' },
  { method: 'PATCH', pattern: '/todos/:id', example: '/todos/followup-001' },

  { method: 'POST', pattern: '/webhooks', example: '/webhooks' },
  { method: 'GET', pattern: '/webhooks', example: '/webhooks' },
  { method: 'DELETE', pattern: '/webhooks/:id', example: '/webhooks/webhook-001' },
  { method: 'GET', pattern: '/webhooks/:id/deliveries', example: '/webhooks/webhook-001/deliveries' },
  { method: 'POST', pattern: '/deliveries/:id/redeliver', example: '/deliveries/dlv-001/redeliver' },

  { method: 'GET', pattern: '/profile', example: '/profile' },
  { method: 'PUT', pattern: '/profile', example: '/profile' },

  { method: 'GET', pattern: '/search', example: '/search' },
  { method: 'GET', pattern: '/dashboard', example: '/dashboard' },
  { method: 'GET', pattern: '/notifications', example: '/notifications' },
  { method: 'GET', pattern: '/reports/:type', example: '/reports/decision_volume' },
  { method: 'GET', pattern: '/export', example: '/export' },
];

/** Served without authentication; whitelisted files only. */
export const PUBLIC_ASSETS: Array<{ path: string; status: number; type?: RegExp }> = [
  { path: '/', status: 200, type: /text\/html/ },
  { path: '/app.js', status: 200, type: /javascript/ },
  { path: '/style.css', status: 200, type: /text\/css/ },
  { path: '/favicon.ico', status: 204 },
];
