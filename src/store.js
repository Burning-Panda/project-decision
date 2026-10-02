/** In-memory store with JSON snapshot support. Plain data only, so it can be swapped for a DB-backed store. */
const MAPS = ['owners', 'teams', 'projects', 'decisions', 'revisions'];
const ARRAYS = ['votes', 'comments', 'followups', 'meetings', 'relationships', 'participants', 'audit', 'notifications', 'webhooks', 'events', 'deliveries'];

export class MemoryStore {
  constructor() {
    for (const m of MAPS) this[m] = new Map();
    for (const a of ARRAYS) this[a] = [];
    this.idempotency = {};
    this.counters = { followup: 0, comment: 0, meeting: 0, notification: 0, webhook: 0, event: 0, delivery: 0 };
  }

  next(counter) {
    return ++this.counters[counter];
  }

  toJSON() {
    const out = { idempotency: this.idempotency, counters: this.counters };
    for (const m of MAPS) out[m] = [...this[m].entries()];
    for (const a of ARRAYS) out[a] = this[a];
    return out;
  }

  static fromJSON(json) {
    const s = new MemoryStore();
    for (const m of MAPS) s[m] = new Map(json[m] ?? []);
    for (const a of ARRAYS) s[a] = json[a] ?? [];
    s.idempotency = json.idempotency ?? {};
    s.counters = { ...s.counters, ...(json.counters ?? {}) };
    return s;
  }
}
