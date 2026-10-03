import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { CreateProjectDto } from '../../admin/dto/create-project.dto';
import type { ProjectSettingsDto } from '../../admin/dto/project-settings.dto';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';
import { TeamsService } from '../teams/teams.service';
import type { ProjectRecord } from './project';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly ctx: LogContext,
    private readonly teams: TeamsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Team admin only. Builds via `Project.create`, then CONFLICT on a duplicate identifier, persists, audits. */
  create(_input: CreateProjectDto & { actor: string }): ProjectRecord {
    throw new NotImplementedError('ProjectsService.create');
  }

  /** NOT_FOUND when absent. */
  get(_identifier: string): ProjectRecord {
    throw new NotImplementedError('ProjectsService.get');
  }

  /** Team admin only. */
  updateSettings(_identifier: string, _actor: string, _settings: ProjectSettingsDto): ProjectRecord {
    throw new NotImplementedError('ProjectsService.updateSettings');
  }
}
