import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiModule } from './api/api.module';
import { NotImplementedError } from './common/errors';
import { DecisionLog } from './decision-log/decision-log';
import { DecisionLogModule } from './decision-log/decision-log.module';
import { NotificationDispatcher } from './decision-log/notifications/notification-dispatcher';
import { EmailChannel, smtpTransport } from './notifications/email';
import { Notifier } from './notifications/index';
import { ConfigError, readConfig, type ServerConfig } from './server/config';
import { startJobs, type Job } from './server/jobs';
import { openStorage } from './server/storage';
import { SecretBox } from './storage/secrets';
import { WebhookDispatcher } from './webhooks/dispatcher';

const logger = new Logger('DecisionLog');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The periodic work the server owns: auto-approval, webhook and notification delivery, pruning. Each run is persisted. */
function backgroundJobs(log: DecisionLog, config: ServerConfig, persist: () => Promise<void>): Job[] {
  const persisted = (run: () => unknown) => async () => { await run(); await persist(); };

  let webhooks: WebhookDispatcher | undefined;
  const jobs: Job[] = [
    { name: 'sweep (auto-approval)', everyMs: MINUTE, run: persisted(() => log.sweep()) },
    {
      name: 'webhook delivery', everyMs: 5_000,
      run: persisted(() => (webhooks ??= new WebhookDispatcher(log, { allowPrivateTargets: config.allowPrivateTargets }) as any).run()),
    },
    {
      name: 'outbox pruning', everyMs: DAY,
      run: persisted(() => { log.pruneOutbox({ olderThanDays: 30 }); log.pruneChannelDeliveries({ olderThanDays: 30 }); }),
    },
  ];

  if (config.email) {
    const { smtpUrl, from, replyTo } = config.email;
    const notifier = new Notifier().register(new EmailChannel({ transport: smtpTransport(smtpUrl), from, ...(replyTo ? { replyTo } : {}) }));
    const notifications = new NotificationDispatcher(log, notifier, config.appUrl ? { appUrl: config.appUrl } : {});
    jobs.push({ name: 'notification delivery', everyMs: 10_000, run: persisted(() => notifications.run()) });
  }
  return jobs;
}

async function bootstrap() {
  const config = readConfig(process.env);

  const storage = await openStorage(config.storage, {
    onConnectionLost: (error) => {
      // The database lock went with the connection; another instance may now write. Exit and let the supervisor restart us.
      logger.error('Lost the database connection (and its lock); exiting.', error as any);
      process.exit(1);
    },
  });
  // The key protects persisted secrets; in memory nothing outlives the process and the log uses a throwaway key.
  const persisted = config.storage.kind !== 'memory';
  const secretBox = persisted && config.secretsKey ? SecretBox.fromEnv(process.env) ?? undefined : undefined;

  const domain = await NestFactory.createApplicationContext(
    DecisionLogModule.register({
      ...(storage.store ? { store: storage.store } : {}),
      ...(secretBox ? { secretBox } : {}),
      allowPrivateTargets: config.allowPrivateTargets,
    }),
  );
  const log = domain.get(DecisionLog);

  if (persisted && config.rotateSecrets) {
    const { rotated } = log.rotateSecrets();
    await storage.persist();
    logger.log(`Re-encrypted ${rotated} secret(s) under the current key; SECRETS_KEY_PREVIOUS can be removed.`);
  }

  const app = await NestFactory.create(ApiModule.register({ log, onMutation: () => storage.persist() }));
  const swagger = new DocumentBuilder()
    .setTitle('Decisions')
    .setDescription('The every projects decisions')
    .setVersion('1.0')
    .addTag('decision')
    .addTag('software projects')
    .build();
  SwaggerModule.setup('api', app, () => SwaggerModule.createDocument(app, swagger));
  await app.listen(config.port);
  logger.log(`Listening on port ${config.port}${config.appUrl ? ` (public URL ${config.appUrl})` : ''}; storage: ${config.storage.kind}`);

  const jobs = startJobs(backgroundJobs(log, config, () => storage.persist()), logger);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.log(`${signal}: flushing and shutting down.`);
    await jobs.stop();
    await app.close();
    await storage.persist();
    await storage.close();
    await domain.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

try {
  await bootstrap();
} catch (e) {
  if (e instanceof ConfigError) logger.error(`Configuration: ${e.message}`);
  else if (e instanceof NotImplementedError) logger.error(`Cannot start: ${e.message} is not implemented yet. Run in memory (unset DATABASE_URL, DATABASE_FILE and DATA_FILE) or implement it first.`);
  else logger.error('Cannot start', e as any);
  process.exit(1);
}
