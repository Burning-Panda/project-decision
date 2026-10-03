import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import { LogContext } from '../core/log-context';
import { DecisionsService } from '../decisions/decisions.service';

/** Related-decision suggestions (pluggable finder, threshold) and manual links. */
@Injectable()
export class RelatedService {
  constructor(private readonly ctx: LogContext, private readonly decisions: DecisionsService) {}

  get(_id: string, _actor: string, _opts?: Record<string, any>): any { throw new NotImplementedError('RelatedService.get'); }
  add(_id: string, _actor: string, _link: { related_decision_id: string; type: string }): any { throw new NotImplementedError('RelatedService.add'); }
  review(_id: string, _relatedId: string, _actor: string, _verdict: string): any { throw new NotImplementedError('RelatedService.review'); }
}
