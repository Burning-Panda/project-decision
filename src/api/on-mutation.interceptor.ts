import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { mergeMap } from 'rxjs';
import { API_OPTIONS, type ApiOptions } from './api-options';

/** Durable-before-ack: awaits onMutation() after a successful write and before the response is sent. */
@Injectable()
export class OnMutationInterceptor implements NestInterceptor {
  constructor(@Inject(API_OPTIONS) private readonly options: ApiOptions) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      mergeMap(async (value) => {
        if (req.method !== 'GET') await this.options.onMutation?.();
        return value;
      }),
    );
  }
}
