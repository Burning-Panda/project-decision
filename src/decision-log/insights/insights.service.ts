import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { SearchQueryDto } from '../../insights/dto/search-query.dto';
import type { ReportQueryDto } from '../../insights/dto/report-query.dto';
import type { ExportQueryDto } from '../../insights/dto/export-query.dto';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';

/** Read-only views over decisions: search, reports, dashboard, export, audit trail. */
@Injectable()
export class InsightsService {
  constructor(private readonly ctx: LogContext, private readonly audit: AuditService) {}

  search(_args: SearchQueryDto & { actor: string }): any { throw new NotImplementedError('InsightsService.search'); }
  report(_type: string, _args: ReportQueryDto & { actor: string }): any { throw new NotImplementedError('InsightsService.report'); }
  dashboard(_user: string): any { throw new NotImplementedError('InsightsService.dashboard'); }
  exportDecisions(_args: ExportQueryDto & { actor: string }): any { throw new NotImplementedError('InsightsService.export'); }
  auditTrail(_filters: Record<string, any> = {}): any { return this.audit.trail(_filters); }
  verifyAuditChain(): any { return this.audit.verifyChain(); }
}
