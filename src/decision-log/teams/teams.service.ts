import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo';
import type { CreateTeamDto } from '../../admin/dto/create-team.dto';
import type { AddTeamMemberDto } from '../../admin/dto/add-team-member.dto';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';
import { OwnersService } from '../owners/owners.service';
import type { Team } from './team';

@Injectable()
export class TeamsService {
  constructor(
    private readonly ctx: LogContext,
    private readonly owners: OwnersService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Org admin only (FORBIDDEN). INVALID without name, CONFLICT if the team exists. */
  create(_input: CreateTeamDto & { actor: string }): Team {
    return todo('TeamsService.create');
  }

  /** Team admin only. Adds the member, or changes the role when already present. INVALID on unknown role. */
  addMember(_input: AddTeamMemberDto & { actor: string }): Team {
    return todo('TeamsService.addMember');
  }

  get(_owner: string, _name = 'default'): Team {
    return todo('TeamsService.get');
  }
}
