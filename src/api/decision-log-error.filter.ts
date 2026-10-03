import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describeError, errorEnvelope } from '../helpers/errors/error-response';
import { actionAttempted } from '../helpers/http/action-attempted';
import { stampHeaders } from '../helpers/http/stamp-headers';
import { RouteTable } from './route-table';

/** Every failure leaves the API in the standard envelope: { success:false, status_code, error:{code,message}, timestamp }. */
@Catch()
export class DecisionLogErrorFilter implements ExceptionFilter {
  constructor(private readonly routes: RouteTable) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const descriptor = describeError(exception, this.routes.methodsFor(req.path));
    stampHeaders(req, res);
    res.status(descriptor.status).json(errorEnvelope(descriptor, actionAttempted(req)));
  }
}
