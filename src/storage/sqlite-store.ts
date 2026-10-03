import { todo } from '../helpers/errors/todo';

export class SqliteStore {
  static open(_file: string): SqliteStore {
    return todo('SqliteStore.open');
  }
}
