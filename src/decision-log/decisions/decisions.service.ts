import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { CreateDecisionDto } from '../../decisions/dto/create-decision.dto';
import type { ListDecisionsQueryDto } from '../../decisions/dto/list-decisions-query.dto';
import type { PerformActionDto } from '../../decisions/dto/perform-action.dto';
import type { DiffQueryDto } from '../../decisions/dto/diff-query.dto';
import { AccessService } from '../core/access.service';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';
import type { Action, AccessVerdict } from '../core/policy';
import { ProjectsService } from '../projects/projects.service';

/** Lifecycle: draft -> proposed -> approved | declined, plus revisions and integrity. */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly ctx: LogContext,
    private readonly projects: ProjectsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  create(_input: CreateDecisionDto & { actor: string }): any { throw new NotImplementedError('DecisionsService.create'); }
  updateDraft(_id: string, _actor: string, _patch: { title?: string; content?: string }): any { throw new NotImplementedError('DecisionsService.updateDraft'); }
  deleteDraft(_id: string, _actor: string): void { throw new NotImplementedError('DecisionsService.deleteDraft'); }
  get(_id: string, _actor: string): any { throw new NotImplementedError('DecisionsService.get'); }
  list(_filters: ListDecisionsQueryDto): any { throw new NotImplementedError('DecisionsService.list'); }

  /** The action state machine (propose, approve, vote, ...). */
  perform(_id: string, _actor: string, _request: PerformActionDto, _opts?: Record<string, any>): any { throw new NotImplementedError('DecisionsService.perform'); }

  /** Would `actor` be allowed to do `action` to this decision? Same rules `perform` enforces. NOT_FOUND if the decision does not exist. */
  can(_id: string, _actor: string, _action: Action): AccessVerdict { throw new NotImplementedError('DecisionsService.can'); }

  /** Auto-approves proposals past their window; returns what changed. */
  sweep(): any { throw new NotImplementedError('DecisionsService.sweep'); }

  versions(_id: string, _actor: string): any { throw new NotImplementedError('DecisionsService.versions'); }
  diff(_id: string, _actor: string, _range: DiffQueryDto): any { throw new NotImplementedError('DecisionsService.diff'); }
  verifyIntegrity(_id: string): any { throw new NotImplementedError('DecisionsService.verifyIntegrity'); }
  participants(_id: string, _actor: string): any { throw new NotImplementedError('DecisionsService.participants'); }
  renderDocument(_id: string, _actor: string): string { throw new NotImplementedError('DecisionsService.renderDocument'); }
}
