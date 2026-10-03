import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo';
import type { Team } from '../teams/team';

/** Who may do what. Pure authorization rules; no persistence of its own. */
@Injectable()
export class AccessService {
  /** The owner identifier acts as organisation admin. */
  isOrgAdmin(_actor: string, _owner: string): boolean {
    return todo('AccessService.isOrgAdmin');
  }

  /** Org admin, or a team member with role `admin`. */
  isTeamAdmin(_actor: string, _team: Team): boolean {
    return todo('AccessService.isTeamAdmin');
  }
}
