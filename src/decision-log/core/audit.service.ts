import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import { LogContext } from './log-context';

/** Append-only, hash-chained audit log. Every mutating service writes through here. */
@Injectable()
export class AuditService {
  constructor(private readonly ctx: LogContext) {}

  record(_actor: string | null, _action: string, _decisionId: string | null, _before: unknown, _after: unknown): void {
    throw new NotImplementedError('AuditService.record');
  }

  trail(_filters: { decision_id?: string; actor?: string; from?: string; to?: string }): unknown[] {
    throw new NotImplementedError('AuditService.trail');
  }

  verifyChain(): { valid: boolean } {
    throw new NotImplementedError('AuditService.verifyChain');
  }
}
