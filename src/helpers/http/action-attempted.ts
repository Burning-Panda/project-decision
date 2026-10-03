import type { Request } from 'express';

/** The action name of a POST /decisions/:id/actions request, for error reporting. */
export function actionAttempted(req: Request): string | undefined {
  const action = req.body?.action;
  return typeof action === 'string' && /\/actions\/?$/.test(req.path) ? action : undefined;
}
