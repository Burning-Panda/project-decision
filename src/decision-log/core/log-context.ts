import { Inject, Injectable } from '@nestjs/common';
import { MemoryStore } from '../../storage/store';

export const DECISION_LOG_OPTIONS = Symbol('DECISION_LOG_OPTIONS');

/** What every feature service shares: the options bag, the clock and the store (created lazily). */
@Injectable()
export class LogContext {
  private memory?: MemoryStore;

  constructor(@Inject(DECISION_LOG_OPTIONS) readonly options: Record<string, any>) {}

  get store(): any {
    return this.options.store ?? (this.memory ??= new MemoryStore());
  }

  now(): string {
    return (this.options.clock?.() ?? new Date()).toISOString();
  }
}
