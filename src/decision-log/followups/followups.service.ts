import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo';
import type { AssignFollowupPayloadDto } from '../../decisions/dto/actions/assign-followup-payload.dto';
import type { AddMeetingPayloadDto } from '../../decisions/dto/actions/add-meeting-payload.dto';
import type { ListTodosQueryDto } from '../../todos/dto/list-todos-query.dto';
import type { UpdateTodoDto } from '../../todos/dto/update-todo.dto';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';
import { DecisionsService } from '../decisions/decisions.service';

/** Follow-ups, the todo view of them, and meeting notes. */
@Injectable()
export class FollowupsService {
  constructor(private readonly ctx: LogContext, private readonly decisions: DecisionsService, private readonly audit: AuditService) {}

  addFollowup(_id: string, _actor: string, _input: AssignFollowupPayloadDto): any { return todo('FollowupsService.addFollowup'); }
  listTodos(_filters: ListTodosQueryDto): any { return todo('FollowupsService.listTodos'); }
  updateTodo(_todoId: string, _actor: string, _patch: UpdateTodoDto): any { return todo('FollowupsService.updateTodo'); }
  todoStats(_user: string): any { return todo('FollowupsService.todoStats'); }
  addMeeting(_id: string, _actor: string, _input: AddMeetingPayloadDto): any { return todo('FollowupsService.addMeeting'); }
  renderMeetingNotes(_id: string, _actor: string): string { return todo('FollowupsService.renderMeetingNotes'); }
}
