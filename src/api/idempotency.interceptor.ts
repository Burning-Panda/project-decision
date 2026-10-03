import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { stampHeaders } from '../helpers/http/stamp-headers';

/** Stamps Request-Date and echoes Idempotency-Key. Replaying a stored result is the domain log's job. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    stampHeaders(http.getRequest<Request>(), http.getResponse<Response>());
    return next.handle();
  }
}
