import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo.js';
import type { CreateDecisionDto } from '../../decisions/dto/create-decision.dto.js';
import type { ListDecisionsQueryDto } from '../../decisions/dto/list-decisions-query.dto.js';
import type { PerformActionDto } from '../../decisions/dto/perform-action.dto.js';
import type { DiffQueryDto } from '../../decisions/dto/diff-query.dto.js';
import { AccessService } from '../core/access.service.js';
import { AuditService } from '../core/audit.service.js';
import { LogContext } from '../core/log-context.js';
import { ProjectsService } from '../projects/projects.service.js';

/** Lifecycle: draft -> proposed -> approved | declined, plus revisions and integrity. */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly ctx: LogContext,
    private readonly projects: ProjectsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  create(_input: CreateDecisionDto & { actor: string }): any { return todo('DecisionsService.create'); }
  updateDraft(_id: string, _actor: string, _patch: { title?: string; content?: string }): any { return todo('DecisionsService.updateDraft'); }
  deleteDraft(_id: string, _actor: string): void { return todo('DecisionsService.deleteDraft'); }
  get(_id: string, _actor: string): any { return todo('DecisionsService.get'); }
  list(_filters: ListDecisionsQueryDto): any { return todo('DecisionsService.list'); }

  /** The action state machine (propose, approve, vote, ...). */
  perform(_id: string, _actor: string, _request: PerformActionDto, _opts?: Record<string, any>): any { return todo('DecisionsService.perform'); }

  /** Auto-approves proposals past their window; returns what changed. */
  sweep(): any { return todo('DecisionsService.sweep'); }

  versions(_id: string, _actor: string): any { return todo('DecisionsService.versions'); }
  diff(_id: string, _actor: string, _range: DiffQueryDto): any { return todo('DecisionsService.diff'); }
  verifyIntegrity(_id: string): any { return todo('DecisionsService.verifyIntegrity'); }
  participants(_id: string, _actor: string): any { return todo('DecisionsService.participants'); }
  renderDocument(_id: string, _actor: string): string { return todo('DecisionsService.renderDocument'); }
}
