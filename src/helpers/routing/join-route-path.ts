/** Joins a controller prefix and a handler path into one normalised path: no duplicate or trailing slashes. */
export function joinRoutePath(base: string, sub: string): string {
  const joined = `/${[base, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}
