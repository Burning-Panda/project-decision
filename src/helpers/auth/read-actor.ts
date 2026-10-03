import type { Request } from 'express';

/** The caller identity from the X-User header (stand-in authentication), or null when absent. */
export function readActor(req: Request): string | null {
  const actor = req.headers['x-user'];
  return actor ? String(actor) : null;
}
