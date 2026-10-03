import { NotImplementedError } from '../common/errors';

export class PostgresStore {
  /** options: { schema, onConnectionLost, onStatement } */
  static async open(_url: string, _options: Record<string, any> = {}): Promise<PostgresStore> {
    throw new NotImplementedError('PostgresStore.open');
  }
}
