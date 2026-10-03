import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo';
import { LogContext } from './log-context';

/** Append-only, hash-chained audit log. Every mutating service writes through here. */
@Injectable()
export class AuditService {
  constructor(private readonly ctx: LogContext) {}

  record(_actor: string | null, _action: string, _decisionId: string | null, _before: unknown, _after: unknown): void {
    return todo('AuditService.record');
  }

  trail(_filters: { decision_id?: string; actor?: string; from?: string; to?: string }): unknown[] {
    return todo('AuditService.trail');
  }

  verifyChain(): { valid: boolean } {
    return todo('AuditService.verifyChain');
  }
}
