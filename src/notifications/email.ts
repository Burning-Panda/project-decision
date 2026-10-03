import { NotImplementedError } from '../common/errors';

export class EmailChannel {
  constructor(_options: Record<string, any>) {
    throw new NotImplementedError('EmailChannel');
  }
}

export class MemoryMailTransport {
  constructor() {
    throw new NotImplementedError('MemoryMailTransport');
  }
}
