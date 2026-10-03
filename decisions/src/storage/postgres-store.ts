import { todo } from '../helpers/errors/todo.js';

export class PostgresStore {
  /** options: { schema, onConnectionLost, onStatement } */
  static async open(_url: string, _options: Record<string, any> = {}): Promise<PostgresStore> {
    return todo('PostgresStore.open');
  }
}
