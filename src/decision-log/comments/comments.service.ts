import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { AddCommentDto } from '../../decisions/dto/add-comment.dto';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';
import { DecisionsService } from '../decisions/decisions.service';

@Injectable()
export class CommentsService {
  constructor(private readonly ctx: LogContext, private readonly decisions: DecisionsService, private readonly audit: AuditService) {}

  add(_id: string, _actor: string, _input: AddCommentDto): any { throw new NotImplementedError('CommentsService.add'); }
  list(_id: string, _actor: string): any { throw new NotImplementedError('CommentsService.list'); }
  edit(_id: string, _commentId: string, _actor: string, _content: string): any { throw new NotImplementedError('CommentsService.edit'); }
  remove(_id: string, _commentId: string, _actor: string): any { throw new NotImplementedError('CommentsService.remove'); }
  resolve(_id: string, _commentId: string, _actor: string, _resolved = true): any { throw new NotImplementedError('CommentsService.resolve'); }
}
