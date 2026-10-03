import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo.js';
import { LogContext } from '../core/log-context.js';
import { DecisionsService } from '../decisions/decisions.service.js';

/** Related-decision suggestions (pluggable finder, threshold) and manual links. */
@Injectable()
export class RelatedService {
  constructor(private readonly ctx: LogContext, private readonly decisions: DecisionsService) {}

  get(_id: string, _actor: string, _opts?: Record<string, any>): any { return todo('RelatedService.get'); }
  add(_id: string, _actor: string, _link: { related_decision_id: string; type: string }): any { return todo('RelatedService.add'); }
  review(_id: string, _relatedId: string, _actor: string, _verdict: string): any { return todo('RelatedService.review'); }
}
