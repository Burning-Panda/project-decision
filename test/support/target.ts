/**
 * The only place the specs touch `src/`. This file IS the contract the implementation must satisfy.
 *
 *   src/decision-log/decision-log.ts          DecisionLog (domain service)
 *   src/decision-log/decision-log.module.ts   DecisionLogModule.register(options) -> provides DecisionLog
 *   src/api/api.module.ts                     ApiModule.register({ log, onMutation? }) -> the HTTP API
 *   src/storage/store.ts                      MemoryStore + collection lists
 *   src/storage/sqlite-store.ts               SqliteStore.open(file)
 *   src/storage/postgres-store.ts             PostgresStore.open(url, { schema, onConnectionLost, onStatement })
 *   src/storage/migrations/postgres.ts        MIGRATIONS
 *   src/storage/secrets.ts                    SecretBox
 *   src/webhooks/dispatcher.ts                WebhookDispatcher, verifySignature
 *   src/notifications/*                       index (manager, channel contract, payloads), mime, smtp, email
 */
import { Test } from '@nestjs/testing';
import { DecisionLog } from '../../src/decision-log/decision-log.js';
import { DecisionLogModule } from '../../src/decision-log/decision-log.module.js';
import { ApiModule } from '../../src/api/api.module.js';
import { onCleanup } from './cleanup.js';

export { DecisionLog } from '../../src/decision-log/decision-log.js';
export { MemoryStore, MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS } from '../../src/storage/store.js';
export { SqliteStore } from '../../src/storage/sqlite-store.js';
export { PostgresStore } from '../../src/storage/postgres-store.js';
export { MIGRATIONS } from '../../src/storage/migrations/postgres.js';
export { SecretBox } from '../../src/storage/secrets.js';
export { WebhookDispatcher, verifySignature } from '../../src/webhooks/dispatcher.js';
export {
  NotificationChannel, NotificationManager, createNotificationPayload, validateNotificationPayload,
  sent, failed, skipped, isDeliveryResult, checkChannelConformance,
} from '../../src/notifications/index.js';
export { buildMimeMessage, formatAddress, parseAddress, dotStuff, encodeWord } from '../../src/notifications/mime.js';
export { SmtpTransport, SmtpError, parseSmtpUrl } from '../../src/notifications/smtp.js';
export { EmailChannel, MemoryMailTransport } from '../../src/notifications/email.js';

/** Boots a DecisionLog through a Nest testing module. Rejects if construction rejects (e.g. missing secret box). */
export async function buildLog(options: Record<string, any> = {}): Promise<any> {
  const moduleRef = await Test.createTestingModule({ imports: [DecisionLogModule.register(options)] }).compile();
  onCleanup(() => moduleRef.close());
  return moduleRef.get(DecisionLog);
}

/** Serves the HTTP API for `log` on an ephemeral loopback port. */
export async function startApi(log: any, options: Record<string, any> = {}): Promise<{ base: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [ApiModule.register({ log, ...options })] }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  onCleanup(() => app.close());
  const { port } = app.getHttpServer().address();
  return { base: `http://127.0.0.1:${port}` };
}

/** Opens a client socket to the loopback port (the `dial` option of SmtpTransport). */
export const dialLocal = (port: number) => Bun.connect({ hostname: '127.0.0.1', port, socket: {} as any });
