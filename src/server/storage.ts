import { mkdir, rename } from 'fs/promises';
import { dirname } from 'path';
import { MemoryStore } from '../storage/store';
import { SqliteStore } from '../storage/sqlite-store';
import { PostgresStore } from '../storage/postgres-store';
import type { StorageConfig } from './config';

export interface OpenedStorage {
  /** Passed to DecisionLogModule; undefined means the log creates its own in-memory store. */
  store?: any;
  /** Makes the latest changes durable. Called after every successful write and after background jobs. */
  persist(): Promise<void>;
  close(): Promise<void>;
}

/** Writes the JSON snapshot to a temporary file and renames it, so a crash never leaves half a file. Writes are serialised. */
function jsonSnapshot(store: any, file: string) {
  let queue: Promise<void> = Promise.resolve();
  const write = async () => {
    const tmp = `${file}.tmp`;
    await Bun.write(tmp, JSON.stringify(store.toJSON()));
    await rename(tmp, file);
  };
  return () => (queue = queue.then(write));
}

export async function openStorage(config: StorageConfig, options: { onConnectionLost?: (error: unknown) => void } = {}): Promise<OpenedStorage> {
  switch (config.kind) {
    case 'memory':
      return { persist: async () => {}, close: async () => {} };

    case 'sqlite': {
      await mkdir(dirname(config.file), { recursive: true });
      const store: any = SqliteStore.open(config.file);
      return { store, persist: async () => { store.commit(); }, close: async () => { store.close(); } };
    }

    case 'postgres': {
      const store: any = await PostgresStore.open(config.url, {
        ...(config.schema ? { schema: config.schema } : {}),
        onConnectionLost: options.onConnectionLost,
      });
      return { store, persist: () => store.commit(), close: () => store.close() };
    }

    case 'json': {
      await mkdir(dirname(config.file), { recursive: true });
      const existing = Bun.file(config.file);
      const store: any = (await existing.exists()) ? MemoryStore.fromJSON(await existing.json()) : new MemoryStore();
      const persist = jsonSnapshot(store, config.file);
      return { store, persist, close: () => persist() };
    }
  }
}
