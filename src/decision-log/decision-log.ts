import { Injectable } from '@nestjs/common';

/** Domain service. Methods are added test-first; see test/lifecycle.spec.ts and friends. */
type owner = {
  identifier: string
  name: string
  email: string
}

interface DecisionLogInterface {
  createOwner: () => {}
  addTeamMember: () => {}
}@Injectable()
export class DecisionLog {
  constructor(readonly options: Record<string, any> = {}) { }

  public createOwner({ identifier, name, email }: owner) {
    return
  }

  public addTeamMember() {
    return
  }

  public createProject() {
    return
  }

  public createDecision() {}
}
