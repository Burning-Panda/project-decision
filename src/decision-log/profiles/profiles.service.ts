import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { UpdateProfileDto } from '../../profile/dto/update-profile.dto';
import { LogContext } from '../core/log-context';

/** User profiles, notification preferences and the in-app notification inbox. */
@Injectable()
export class ProfilesService {
  constructor(private readonly ctx: LogContext) {}

  get(_user: string, _actor: string): any { throw new NotImplementedError('ProfilesService.get'); }
  set(_user: string, _actor: string, _input: UpdateProfileDto): any { throw new NotImplementedError('ProfilesService.set'); }
  listNotifications(_user: string): any { throw new NotImplementedError('ProfilesService.listNotifications'); }
}
