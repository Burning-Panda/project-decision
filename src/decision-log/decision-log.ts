import { Injectable } from '@nestjs/common';

/** Domain service. Methods are added test-first; see test/lifecycle.spec.ts and friends. */
@Injectable()
export class DecisionLog {
  constructor(readonly options: Record<string, any> = {}) {}
}
