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
import { DecisionLog } from '../../src/decision-log/decision-log';
import { DecisionLogModule } from '../../src/decision-log/decision-log.module';
import { ApiModule } from '../../src/api/api.module';
import { onCleanup } from './cleanup';

export { DecisionLog } from '../../src/decision-log/decision-log';
export { MemoryStore, MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS } from '../../src/storage/store';
export { SqliteStore } from '../../src/storage/sqlite-store';
export { PostgresStore } from '../../src/storage/postgres-store';
export { MIGRATIONS } from '../../src/storage/migrations/postgres';
export { SecretBox } from '../../src/storage/secrets';
export { WebhookDispatcher, verifySignature } from '../../src/webhooks/dispatcher';
export {
  NotificationChannel, NotificationManager, createNotificationPayload, validateNotificationPayload,
  sent, failed, skipped, isDeliveryResult, checkChannelConformance,
} from '../../src/notifications/index';
export { buildMimeMessage, formatAddress, parseAddress, dotStuff, encodeWord } from '../../src/notifications/mime';
export { SmtpTransport, SmtpError, parseSmtpUrl } from '../../src/notifications/smtp';
export { EmailChannel, MemoryMailTransport } from '../../src/notifications/email';

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
