import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { Team } from '../teams/team';

/** Who may do what. Pure authorization rules; no persistence of its own. */
@Injectable()
export class AccessService {
  /** The owner identifier acts as organisation admin. */
  isOrgAdmin(_actor: string, _owner: string): boolean {
    throw new NotImplementedError('AccessService.isOrgAdmin');
  }

  /** Org admin, or a team member with role `admin`. */
  isTeamAdmin(_actor: string, _team: Team): boolean {
    throw new NotImplementedError('AccessService.isTeamAdmin');
  }
}
