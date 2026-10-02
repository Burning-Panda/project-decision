import fs from 'node:fs';
import { DecisionLog, MemoryStore } from './decision-log.js';
import { createApp } from './api.js';

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
const log = new DecisionLog({ store });

createApp(log, { onMutation: save }).listen(port, () => console.log(`decision-log listening on :${port}`));

// Veto-mode decisions auto-approve once their objection window has passed.
setInterval(() => { if (log.sweep().length) save?.(); }, 60_000).unref();
