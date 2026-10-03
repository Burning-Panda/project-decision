/** JSON HTTP caller bound to a base URL; mirrors the envelope the API is specified to return. */
export function makeCaller(base: string) {
  return async function call(
    method: string,
    path: string,
    { user, body, headers = {} }: { user?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : (null as any) };
  };
}
