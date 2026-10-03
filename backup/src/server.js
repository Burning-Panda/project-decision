import fs from 'node:fs';
import { DecisionLog, MemoryStore } from './decision-log.js';
import { createApp } from './api.js';
import { WebhookDispatcher } from './webhooks.js';
import { SecretBox } from './secrets.js';
import { NotificationManager, EmailChannel, SmtpTransport, parseSmtpUrl } from './notifications/index.js';

const die = (msg) => { console.error(msg); process.exit(1); };

const port = Number(process.env.PORT ?? 3000);
const { DATABASE_URL: dbUrl, DATABASE_FILE: dbFile, DATA_FILE: dataFile } = process.env;
if ([dbUrl, dbFile, dataFile].filter(Boolean).length > 1) die('Set only one of DATABASE_URL (PostgreSQL), DATABASE_FILE (SQLite) or DATA_FILE (JSON snapshot).');
const persisted = Boolean(dbUrl || dbFile || dataFile);

const secretBox = SecretBox.fromEnv();
if (persisted && !secretBox) {
  die('SECRETS_KEY is required when data is persisted (DATABASE_URL / DATABASE_FILE / DATA_FILE).\n'
    + "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n"
    + 'To rotate, set the new key as SECRETS_KEY and keep the old one in SECRETS_KEY_PREVIOUS.');
}

// ---- storage -------------------------------------------------------------------------------
let store = new MemoryStore();
let save; // async; resolves once the current state is durable
if (dbUrl) {
  const { PostgresStore } = await import('./postgres-store.js');
  try {
    store = await PostgresStore.open(dbUrl, {
      schema: process.env.DATABASE_SCHEMA ?? 'decision_log',
      onConnectionLost: (e) => die(`database connection lost (${e.message}); exiting so the supervisor can restart and re-acquire the lock`),
    });
  } catch (e) { die(`Cannot use PostgreSQL: ${e.message}`); }
  save = () => store.commit();
} else if (dbFile) {
  const { SqliteStore } = await import('./sqlite-store.js');
  store = SqliteStore.open(dbFile);
  save = () => store.commit();
} else if (dataFile) {
  if (fs.existsSync(dataFile)) store = MemoryStore.fromJSON(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  store.persistent = true;
  save = () => {
    fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify(store.toJSON()));
    fs.renameSync(`${dataFile}.tmp`, dataFile);
  };
}
/** For background jobs: never let a persistence error become an unhandled rejection that kills the process. */
const saveQuietly = async () => { try { await save?.(); } catch (e) { console.error('persisting state failed (will retry on the next change):', e.message); } };

// ---- domain --------------------------------------------------------------------------------
const allowPrivateTargets = process.env.WEBHOOK_ALLOW_PRIVATE === '1';
const log = new DecisionLog({ store, secretBox: secretBox ?? undefined, allowPrivateWebhookTargets: allowPrivateTargets });
try {
  if (log.rotateSecrets().rotated) console.log('re-encrypted secrets under the current SECRETS_KEY');
} catch (e) {
  die(`Cannot decrypt stored secrets with the configured keys (${e.message}).\nKeep every key that was ever used in SECRETS_KEY_PREVIOUS until secrets are rotated.`);
}
await saveQuietly(); // persist any migration/rotation done at startup
const dispatcher = new WebhookDispatcher(log, { allowPrivateTargets });

// Notification channels. Only email exists today; see docs/NOTIFICATIONS.md to add SMS/push.
const notifications = new NotificationManager(log, { appUrl: process.env.APP_URL });
if (process.env.SMTP_URL) {
  if (!process.env.EMAIL_FROM) die('EMAIL_FROM is required when SMTP_URL is set');
  try {
    notifications.register(new EmailChannel({
      transport: new SmtpTransport(parseSmtpUrl(process.env.SMTP_URL)),
      from: process.env.EMAIL_FROM,
      replyTo: process.env.EMAIL_REPLY_TO,
      appName: process.env.APP_NAME ?? 'Decision Log',
    }));
  } catch (e) { die(`Invalid email configuration: ${e.message}`); }
  console.log('email notifications enabled');
}

const server = createApp(log, { onMutation: save }).listen(port, () => console.log(`decision-log listening on :${port}`));

// ---- background jobs -----------------------------------------------------------------------
const every = (ms, fn) => setInterval(async () => {
  try { await fn(); } catch (e) { console.error('background job failed:', e); }
}, ms).unref();

// Veto-mode decisions auto-approve once their objection window has passed.
every(60_000, async () => { if (log.sweep().length) await saveQuietly(); });

// Keep the outbox bounded.
every(3_600_000, async () => {
  const r = log.pruneOutbox({ olderThanDays: 30 });
  const c = log.pruneChannelDeliveries({ olderThanDays: 30 });
  if (r.deliveries || r.events || c.removed) await saveQuietly();
});

// Webhook deliveries are queued transactionally with each change and sent from here.
every(5_000, async () => { if ((await dispatcher.run()).attempted) await saveQuietly(); });

// Sends queued notifications through the registered channels (no-op when none are configured).
if (notifications.channelNames.length) {
  every(5_000, async () => {
    const st = await notifications.run();
    if (st.planned || st.sent || st.failed || st.skipped || st.retrying) await saveQuietly();
  });
}

// ---- graceful shutdown ---------------------------------------------------------------------
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  server.close();
  await saveQuietly();
  await store.close?.();
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
