import fs from 'node:fs';
import { DecisionLog, MemoryStore } from './decision-log.js';
import { createApp } from './api.js';
import { WebhookDispatcher } from './webhooks.js';

const port = Number(process.env.PORT ?? 3000);
const dataFile = process.env.DATA_FILE;

const dbFile = process.env.DATABASE_FILE;

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
const log = new DecisionLog({ store, allowPrivateWebhookTargets: allowPrivateTargets });
const dispatcher = new WebhookDispatcher(log, { allowPrivateTargets });

createApp(log, { onMutation: save }).listen(port, () => console.log(`decision-log listening on :${port}`));

// Veto-mode decisions auto-approve once their objection window has passed.
setInterval(() => { if (log.sweep().length) save?.(); }, 60_000).unref();

// Keep the outbox bounded.
setInterval(() => { const r = log.pruneOutbox({ olderThanDays: 30 }); if (r.deliveries || r.events) save?.(); }, 3_600_000).unref();

// Webhook deliveries are queued transactionally with each change and sent from here.
setInterval(async () => {
  try { if ((await dispatcher.run()).attempted) save?.(); } catch (e) { console.error('webhook dispatch failed', e); }
}, 5_000).unref();
