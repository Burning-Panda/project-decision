const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Turns a route path such as /decisions/:id/actions into a matcher for concrete request paths. */
export function routePattern(path: string): RegExp {
  const body = path.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : escapeRegExp(seg))).join('/');
  return new RegExp(`^${body}/?$`);
}
