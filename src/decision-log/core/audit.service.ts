import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import { LogContext } from './log-context';

/** One link of the audit hash chain. `hv` is the hash version: 2 hashes canonical (key-sorted) JSON, legacy entries have none. */
export interface AuditEntry {
  seq: number;
  at: string;
  actor: string | null;
  action: string;
  decision_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  detail: unknown;
  prev_hash: string;
  hash: string;
  hv?: number;
}

/** Append-only, hash-chained audit log. Every mutating service writes through here. */
@Injectable()
export class AuditService {
  constructor(private readonly ctx: LogContext) {}

  record(
    _actor: string | null, _action: string, _decisionId: string | null, _before: unknown, _after: unknown,
    _extra: { ip?: string | null; detail?: unknown } = {},
  ): AuditEntry {
    throw new NotImplementedError('AuditService.record');
  }

  trail(_filters: { decision_id?: string; actor?: string; from?: string; to?: string }): AuditEntry[] {
    throw new NotImplementedError('AuditService.trail');
  }

  /** `broken_at` is the seq of the first entry whose hash or link does not verify. */
  verifyChain(): { ok: boolean; broken_at: number | null } {
    throw new NotImplementedError('AuditService.verifyChain');
  }
}
