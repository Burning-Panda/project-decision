import type { Response } from 'express';

/** Sends a static file as text with the given content type and nosniff. */
export async function sendAsset(res: Response, absolutePath: string, type: string) {
  res
    .status(200)
    .type(`${type}; charset=utf-8`)
    .set('x-content-type-options', 'nosniff')
    .send(await Bun.file(absolutePath).text());
}
