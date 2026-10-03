import { NotImplementedError } from '../common/errors';

export class SqliteStore {
  static open(_file: string): SqliteStore {
    throw new NotImplementedError('SqliteStore.open');
  }
}
