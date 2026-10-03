import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { fileURLToPath } from 'url';
import { sendAsset } from '../helpers/files/send-asset';

// Relative to this file, so it works from src/ and from the build (dist/ui/ is at the same depth) whatever the working directory.
const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

/** The web UI. Public (no X-User) and whitelisted: only these four paths are served. */
@Controller()
export class UiController {
  @Get()
  index(@Res() res: Response) {
    return sendAsset(res, PUBLIC_DIR + 'index.html', 'text/html');
  }

  @Get('app')
  script(@Res() res: Response) {
    return sendAsset(res, PUBLIC_DIR + 'app', 'text/javascript');
  }

  @Get('style.css')
  style(@Res() res: Response) {
    return sendAsset(res, PUBLIC_DIR + 'style.css', 'text/css');
  }

  @Get('favicon.ico')
  @HttpCode(204)
  favicon() {}
}
