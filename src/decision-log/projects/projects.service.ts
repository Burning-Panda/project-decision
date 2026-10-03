import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo.js';
import type { CreateProjectDto } from '../../admin/dto/create-project.dto.js';
import type { ProjectSettingsDto } from '../../admin/dto/project-settings.dto.js';
import { AccessService } from '../core/access.service.js';
import { AuditService } from '../core/audit.service.js';
import { LogContext } from '../core/log-context.js';
import { TeamsService } from '../teams/teams.service.js';
import type { ProjectRecord } from './project.js';

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
    return todo('ProjectsService.create');
  }

  /** NOT_FOUND when absent. */
  get(_identifier: string): ProjectRecord {
    return todo('ProjectsService.get');
  }

  /** Team admin only. */
  updateSettings(_identifier: string, _actor: string, _settings: ProjectSettingsDto): ProjectRecord {
    return todo('ProjectsService.updateSettings');
  }
}
