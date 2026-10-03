/** Server configuration read from the environment (see .env.example). Invalid combinations are refused up front. */
export type StorageConfig =
  | { kind: 'memory' }
  | { kind: 'sqlite'; file: string }
  | { kind: 'postgres'; url: string; schema?: string }
  | { kind: 'json'; file: string };

export interface EmailConfig { smtpUrl: string; from: string; replyTo?: string }

export interface ServerConfig {
  port: number;
  appUrl?: string;
  storage: StorageConfig;
  /** SECRETS_KEY is set; SecretBox.fromEnv parses it. */
  secretsKey: boolean;
  /** SECRETS_KEY_PREVIOUS is set: re-encrypt everything under the current key on start. */
  rotateSecrets: boolean;
  allowPrivateTargets: boolean;
  email?: EmailConfig;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const set = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';
const flag = (v: string | undefined) => set(v) && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());

function readStorage(env: Record<string, string | undefined>): StorageConfig {
  const chosen = (['DATABASE_URL', 'DATABASE_FILE', 'DATA_FILE'] as const).filter((k) => set(env[k]));
  if (chosen.length > 1) throw new ConfigError(`Set at most one storage option; found ${chosen.join(', ')}.`);
  if (set(env.DATABASE_URL)) return { kind: 'postgres', url: env.DATABASE_URL, ...(set(env.DATABASE_SCHEMA) ? { schema: env.DATABASE_SCHEMA } : {}) };
  if (set(env.DATABASE_FILE)) return { kind: 'sqlite', file: env.DATABASE_FILE };
  if (set(env.DATA_FILE)) return { kind: 'json', file: env.DATA_FILE };
  return { kind: 'memory' };
}

export function readConfig(env: Record<string, string | undefined>): ServerConfig {
  const port = set(env.PORT) ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`PORT must be a port number; got "${env.PORT}".`);

  const storage = readStorage(env);
  const secretsKey = set(env.SECRETS_KEY);
  if (storage.kind !== 'memory' && !secretsKey) {
    throw new ConfigError('SECRETS_KEY is required when data is persisted (DATABASE_URL, DATABASE_FILE or DATA_FILE). See .env.example.');
  }

  let email: EmailConfig | undefined;
  if (set(env.SMTP_URL)) {
    if (!set(env.EMAIL_FROM)) throw new ConfigError('EMAIL_FROM is required when SMTP_URL is set.');
    email = { smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM, ...(set(env.EMAIL_REPLY_TO) ? { replyTo: env.EMAIL_REPLY_TO } : {}) };
  }

  return {
    port,
    ...(set(env.APP_URL) ? { appUrl: env.APP_URL } : {}),
    storage,
    secretsKey,
    rotateSecrets: set(env.SECRETS_KEY_PREVIOUS),
    allowPrivateTargets: flag(env.WEBHOOK_ALLOW_PRIVATE),
    ...(email ? { email } : {}),
  };
}
