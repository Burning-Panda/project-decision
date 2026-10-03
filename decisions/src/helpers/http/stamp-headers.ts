import type { Request, Response } from 'express';

/** Headers every response carries; the Idempotency-Key is echoed when supplied. */
export function stampHeaders(req: Request, res: Response) {
  res.setHeader('request-date', new Date().toISOString());
  const key = req.headers['idempotency-key'];
  if (key) res.setHeader('idempotency-key', String(key));
}
