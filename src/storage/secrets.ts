import { NotImplementedError } from '../common/errors';

export class SecretBox {
  constructor(_options: { keys: Buffer[] }) {
    throw new NotImplementedError('SecretBox');
  }
  static fromEnv(_env: Record<string, string | undefined> = process.env): SecretBox | null {
    throw new NotImplementedError('SecretBox.fromEnv');
  }
  static isEncrypted(_value: unknown): boolean {
    throw new NotImplementedError('SecretBox.isEncrypted');
  }
}
