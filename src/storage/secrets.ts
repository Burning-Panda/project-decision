import { todo } from '../helpers/errors/todo';

export class SecretBox {
  constructor(_options: { keys: Buffer[] }) {
    todo('SecretBox');
  }
  static fromEnv(_env: Record<string, string | undefined> = process.env): SecretBox | null {
    return todo('SecretBox.fromEnv');
  }
  static isEncrypted(_value: unknown): boolean {
    return todo('SecretBox.isEncrypted');
  }
}
