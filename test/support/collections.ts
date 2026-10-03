import { MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS } from './target';

export type CollectionKind = 'map' | 'array' | 'record';

/** Every collection the store declares, with its kind. Read at call time so it follows src/storage/store.ts. */
export const allCollections = (): Array<{ name: string; kind: CollectionKind }> => [
  ...MAP_COLLECTIONS.map((name) => ({ name, kind: 'map' as const })),
  ...ARRAY_COLLECTIONS.map((name) => ({ name, kind: 'array' as const })),
  ...RECORD_COLLECTIONS.map((name) => ({ name, kind: 'record' as const })),
];

/** Writes `doc` under `key` in collection `name` of `store`, whatever its kind (array documents carry the key as `id`). */
export function putDoc(store: any, name: string, kind: CollectionKind, key: string, doc: Record<string, unknown>) {
  if (kind === 'map') store[name].set(key, doc);
  else if (kind === 'array') store[name].push({ id: key, ...doc });
  else store[name][key] = doc;
}

/** Reads the document stored under `key` by putDoc. */
export function getDoc(store: any, name: string, kind: CollectionKind, key: string): any {
  if (kind === 'map') return store[name].get(key);
  if (kind === 'array') return store[name].find((d: any) => d.id === key);
  return store[name][key];
}
