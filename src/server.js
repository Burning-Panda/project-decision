import fs from 'node:fs';
import { DecisionLog, MemoryStore } from './decision-log.js';
import { createApp } from './api.js';
import { WebhookDispatcher } from './webhooks.js';
import { SecretBox } from './secrets.js';
import { NotificationManager, EmailChannel, SmtpTransport, parseSmtpUrl } from './notifications/index.js';

const port = Number(process.env.PORT ?? 3000);
const dataFile = process.env.DATA_FILE;

const dbFile = process.env.DATABASE_FILE;

const secretBox = SecretBox.fromEnv();
if ((dbFile || dataFile) && !secretBox) {
  console.error('SECRETS_KEY is required when data is persisted (DATABASE_FILE / DATA_FILE).\n'
    + "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n"
    + 'To rotate, set the new key as SECRETS_KEY and keep the old one in SECRETS_KEY_PREVIOUS.');
  process.exit(1);
}

let store = new MemoryStore();
let save;
if (dbFile) {
  const { SqliteStore } = await import('./sqlite-store.js');
  store = SqliteStore.open(dbFile);
  save = () => store.commit();
} else if (dataFile) {
  if (fs.existsSync(dataFile)) store = MemoryStore.fromJSON(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  save = () => {
    fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify(store.toJSON()));
    fs.renameSync(`${dataFile}.tmp`, dataFile);
  };
}
const allowPrivateTargets = process.env.WEBHOOK_ALLOW_PRIVATE === '1';
store.persistent = Boolean(dbFile || dataFile);
const log = new DecisionLog({ store, secretBox: secretBox ?? undefined, allowPrivateWebhookTargets: allowPrivateTargets });
try {
  if (log.rotateSecrets().rotated) console.log('re-encrypted secrets under the current SECRETS_KEY');
} catch (e) {
  console.error(`Cannot decrypt stored secrets with the configured keys (${e.message}).\nKeep every key that was ever used in SECRETS_KEY_PREVIOUS until secrets are rotated.`);
  process.exit(1);
}
save?.(); // persist any migration/rotation done at startup
const dispatcher = new WebhookDispatcher(log, { allowPrivateTargets });

// Notification channels. Only email exists today; see docs/NOTIFICATIONS.md to add SMS/push.
const notifications = new NotificationManager(log, { appUrl: process.env.APP_URL });
if (process.env.SMTP_URL) {
  if (!process.env.EMAIL_FROM) { console.error('EMAIL_FROM is required when SMTP_URL is set'); process.exit(1); }
  try {
    notifications.register(new EmailChannel({
      transport: new SmtpTransport(parseSmtpUrl(process.env.SMTP_URL)),
      from: process.env.EMAIL_FROM,
      replyTo: process.env.EMAIL_REPLY_TO,
      appName: process.env.APP_NAME ?? 'Decision Log',
    }));
  } catch (e) { console.error(`Invalid email configuration: ${e.message}`); process.exit(1); }
  console.log('email notifications enabled');
}

createApp(log, { onMutation: save }).listen(port, () => console.log(`decision-log listening on :${port}`));

// Veto-mode decisions auto-approve once their objection window has passed.
setInterval(() => { if (log.sweep().length) save?.(); }, 60_000).unref();

// Keep the outbox bounded.
setInterval(() => {
  const r = log.pruneOutbox({ olderThanDays: 30 });
  const c = log.pruneChannelDeliveries({ olderThanDays: 30 });
  if (r.deliveries || r.events || c.removed) save?.();
}, 3_600_000).unref();

// Webhook deliveries are queued transactionally with each change and sent from here.
setInterval(async () => {
  try { if ((await dispatcher.run()).attempted) save?.(); } catch (e) { console.error('webhook dispatch failed', e); }
}, 5_000).unref();

// Sends queued notifications through the registered channels (no-op when none are configured).
if (notifications.channelNames.length) {
  setInterval(async () => {
    try {
      const st = await notifications.run();
      if (st.planned || st.sent || st.failed || st.skipped || st.retrying) save?.();
    } catch (e) { console.error('notification dispatch failed', e); }
  }, 5_000).unref();
}
