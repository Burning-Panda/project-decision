import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo';
import type { AddCommentDto } from '../../decisions/dto/add-comment.dto';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';
import { DecisionsService } from '../decisions/decisions.service';

@Injectable()
export class CommentsService {
  constructor(private readonly ctx: LogContext, private readonly decisions: DecisionsService, private readonly audit: AuditService) {}

  add(_id: string, _actor: string, _input: AddCommentDto): any { return todo('CommentsService.add'); }
  list(_id: string, _actor: string): any { return todo('CommentsService.list'); }
  edit(_id: string, _commentId: string, _actor: string, _content: string): any { return todo('CommentsService.edit'); }
  remove(_id: string, _commentId: string, _actor: string): any { return todo('CommentsService.remove'); }
  resolve(_id: string, _commentId: string, _actor: string, _resolved = true): any { return todo('CommentsService.resolve'); }
}
