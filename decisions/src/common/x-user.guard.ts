import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { readActor } from '../helpers/auth/read-actor.js';
import { DecisionLogError } from './errors.js';

/** Stand-in authentication: the caller is whoever the X-User header says. Replace with real auth before exposing publicly. */
@Injectable()
export class XUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { actor?: string }>();
    const actor = readActor(req);
    if (!actor) throw new DecisionLogError('UNAUTHENTICATED', 'X-User header is required', 401);
    req.actor = actor;
    return true;
  }
}
