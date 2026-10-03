import { describe, it, expect, beforeEach } from 'bun:test';
import {
  MemoryStore, SqliteStore, allCollections, putDoc, getDoc, tmpDbFile, onCleanup, usePostgres, HAS_PG,
} from '../support/index';

// Every collection declared in src/storage/store.ts must survive every store. When a feature adds a collection,
// these specs fail until the stores (and their migrations) handle it.
//
// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.

const FIRST = { n: 1, label: 'first' };
const SECOND = { n: 2, label: 'second' };

describe('every collection round-trips through the JSON snapshot', () => {
  for (const { name, kind } of allCollections()) {
    describe(`GIVEN two documents in ${name}`, () => {
      let store: any;
      beforeEach(() => {
        store = new MemoryStore();
        putDoc(store, name, kind, 'k1', FIRST);
        putDoc(store, name, kind, 'k2', SECOND);
      });

      describe('WHEN the store is serialised and restored', () => {
        let restored: any;
        beforeEach(() => { restored = MemoryStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON()))); });

        it('THEN both documents come back', () => {
          expect(getDoc(restored, name, kind, 'k1')).toMatchObject(FIRST);
          expect(getDoc(restored, name, kind, 'k2')).toMatchObject(SECOND);
        });

        if (kind === 'array') {
          it('THEN their order is kept', () => {
            expect(restored[name].map((d: any) => d.id)).toEqual(['k1', 'k2']);
          });
        }
      });
    });
  }
});

describe('every collection round-trips through SQLite', () => {
  for (const { name, kind } of allCollections()) {
    describe(`GIVEN two documents committed to ${name} and the file closed`, () => {
      let file: string;
      beforeEach(() => {
        file = tmpDbFile('dl-coll-');
        const store: any = SqliteStore.open(file);
        onCleanup(() => store.close());
        putDoc(store, name, kind, 'k1', FIRST);
        putDoc(store, name, kind, 'k2', SECOND);
        store.commit();
        store.close();
      });

      describe('WHEN the file is reopened', () => {
        let again: any;
        beforeEach(() => {
          again = SqliteStore.open(file);
          onCleanup(() => again.close());
        });

        it('THEN both documents come back', () => {
          expect(getDoc(again, name, kind, 'k1')).toMatchObject(FIRST);
          expect(getDoc(again, name, kind, 'k2')).toMatchObject(SECOND);
        });

        if (kind === 'array') {
          it('THEN their order is kept', () => {
            expect(again[name].map((d: any) => d.id)).toEqual(['k1', 'k2']);
          });
        }
      });
    });
  }
});

describe.skipIf(!HAS_PG)('every collection round-trips through PostgreSQL', () => {
  const pg = usePostgres();

  for (const { name, kind } of allCollections()) {
    describe(`GIVEN two documents committed to ${name} and the store closed`, () => {
      beforeEach(async () => {
        const store: any = await pg.open();
        putDoc(store, name, kind, 'k1', FIRST);
        putDoc(store, name, kind, 'k2', SECOND);
        await store.commit();
        await store.close();
      });

      describe('WHEN the schema is reopened', () => {
        let again: any;
        beforeEach(async () => { again = await pg.open(); });

        it('THEN both documents come back', () => {
          expect(getDoc(again, name, kind, 'k1')).toMatchObject(FIRST);
          expect(getDoc(again, name, kind, 'k2')).toMatchObject(SECOND);
        });

        if (kind === 'array') {
          it('THEN their order is kept', () => {
            expect(again[name].map((d: any) => d.id)).toEqual(['k1', 'k2']);
          });
        }
      });
    });
  }
});
