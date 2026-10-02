import fs from 'node:fs';
import { DecisionLog, MemoryStore } from './decision-log.js';
import { createApp } from './api.js';

const port = Number(process.env.PORT ?? 3000);
const dataFile = process.env.DATA_FILE;

let store = new MemoryStore();
if (dataFile && fs.existsSync(dataFile)) store = MemoryStore.fromJSON(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
const log = new DecisionLog({ store });

const save = dataFile
  ? () => {
      fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify(store.toJSON()));
      fs.renameSync(`${dataFile}.tmp`, dataFile);
    }
  : undefined;

createApp(log, { onMutation: save }).listen(port, () => console.log(`decision-log listening on :${port}`));

// Veto-mode decisions auto-approve once their objection window has passed.
setInterval(() => { if (log.sweep().length) save?.(); }, 60_000).unref();
