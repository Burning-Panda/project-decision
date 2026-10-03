import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo.js';
import type { UpdateProfileDto } from '../../profile/dto/update-profile.dto.js';
import { LogContext } from '../core/log-context.js';

/** User profiles, notification preferences and the in-app notification inbox. */
@Injectable()
export class ProfilesService {
  constructor(private readonly ctx: LogContext) {}

  get(_user: string, _actor: string): any { return todo('ProfilesService.get'); }
  set(_user: string, _actor: string, _input: UpdateProfileDto): any { return todo('ProfilesService.set'); }
  listNotifications(_user: string): any { return todo('ProfilesService.listNotifications'); }
}
