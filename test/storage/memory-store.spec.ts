import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryStore, MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS } from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// The store is the in-memory working set every service reads and writes; persistent stores build on it.

const ACME = { identifier: 'acme', name: 'Acme Inc', email: 'root@acme.com' };
const DEFAULT_TEAM = { owner: 'acme', name: 'default', members: [{ user: 'alice@acme.com', role: 'member' }] };
const AUDIT_ENTRY = { seq: 1, actor: 'acme', action: 'create' };

/** A memory store holding owner acme, its default team and one audit entry. */
function filledStore() {
  const store: any = new MemoryStore();
  store.owners.set('acme', ACME);
  store.teams.set('acme/default', DEFAULT_TEAM);
  store.audit.push(AUDIT_ENTRY);
  return store;
}

describe('a new memory store holds every collection, empty, and is not persistent', () => {
  describe('GIVEN nothing', () => {
    describe('WHEN a memory store is created', () => {
      let store: any;
      beforeEach(() => { store = new MemoryStore(); });

      for (const name of MAP_COLLECTIONS) {
        it(`THEN ${name} is an empty Map`, () => {
          expect(store[name]).toBeInstanceOf(Map);
          expect(store[name].size).toBe(0);
        });
      }

      for (const name of ARRAY_COLLECTIONS) {
        it(`THEN ${name} is an empty array`, () => {
          expect(store[name]).toEqual([]);
        });
      }

      for (const name of RECORD_COLLECTIONS) {
        it(`THEN ${name} is an empty object`, () => {
          expect(store[name]).toEqual({});
        });
      }

      it('THEN it is not persistent', () => {
        expect(store.persistent).toBe(false);
      });
    });
  });
});

describe('the JSON snapshot is plain JSON and round-trips', () => {
  describe('GIVEN a store with owner acme, its default team and an audit entry', () => {
    let store: any;
    beforeEach(() => { store = filledStore(); });

    describe('WHEN it is snapshotted with toJSON', () => {
      let json: any;
      beforeEach(() => { json = store.toJSON(); });

      it('THEN maps become objects keyed by id', () => {
        expect(json.owners).toEqual({ acme: ACME });
        expect(json.teams).toEqual({ 'acme/default': DEFAULT_TEAM });
      });

      it('THEN arrays stay arrays', () => {
        expect(json.audit).toEqual([AUDIT_ENTRY]);
      });

      it('THEN it survives JSON.stringify unchanged', () => {
        expect(JSON.parse(JSON.stringify(json))).toEqual(json);
      });
    });

    describe('WHEN it is restored with fromJSON from its serialised snapshot', () => {
      let restored: any;
      beforeEach(() => { restored = MemoryStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON()))); });

      it('THEN the documents are equal and maps are Maps again', () => {
        expect(restored.owners).toBeInstanceOf(Map);
        expect(restored.owners.get('acme')).toEqual(ACME);
        expect(restored.teams.get('acme/default')).toEqual(DEFAULT_TEAM);
        expect(restored.audit).toEqual([AUDIT_ENTRY]);
      });
    });
  });

  describe('GIVEN a store and a copy restored from its snapshot', () => {
    let store: any;
    let restored: any;
    beforeEach(() => {
      store = filledStore();
      restored = MemoryStore.fromJSON(store.toJSON());
    });

    describe('WHEN the copy\'s owner is renamed', () => {
      beforeEach(() => { restored.owners.get('acme').name = 'Changed'; });

      it('THEN the original is unchanged (the snapshot shares no objects)', () => {
        expect(store.owners.get('acme').name).toBe('Acme Inc');
      });
    });
  });

  describe('GIVEN a snapshot written before the audit collection existed', () => {
    let json: any;
    beforeEach(() => { json = { owners: { acme: ACME } }; });

    describe('WHEN it is restored', () => {
      let restored: any;
      beforeEach(() => { restored = MemoryStore.fromJSON(json); });

      it('THEN the missing collection starts empty', () => {
        expect(restored.owners.get('acme')).toEqual(ACME);
        expect(restored.audit).toEqual([]);
      });
    });
  });
});
