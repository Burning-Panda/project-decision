import { todo } from '../helpers/errors/todo.js';

export class SqliteStore {
  static open(_file: string): SqliteStore {
    return todo('SqliteStore.open');
  }
}
