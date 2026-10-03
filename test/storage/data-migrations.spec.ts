import { describe, it, expect, beforeEach } from 'bun:test';
import {
  MemoryStore, SqliteStore, DATA_MIGRATIONS, applyDataMigrations, attempt, tmpDbFile, onCleanup,
  type DataMigration,
} from '../support/index';

// Data migrations upgrade documents that are already stored when their shape changes. Schema migrations change tables;
// these change what is inside them. They run on start, in version order, once each, and are recorded in
// store.data_migrations.
//
// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.

const NOW = '2024-03-20T10:00:00.000Z';
const ctx = { now: () => NOW };

/** v1: projects stored before `description` existed get an empty one. Counts its runs. */
function defaultDescription() {
  const migration = {
    runs: 0,
    version: 1,
    name: 'project description defaults to empty',
    up(store: any) {
      migration.runs++;
      for (const p of store.projects.values()) p.description ??= '';
    },
  };
  return migration;
}

/** A migration that only records that it ran. */
const marker = (version: number, calls: number[]): DataMigration => ({ version, name: `marker ${version}`, up: () => { calls.push(version); } });

/** A memory store with two projects saved before `description` existed. */
function oldProjects() {
  const store: any = new MemoryStore();
  store.projects.set('PRJ', { identifier: 'PRJ', title: 'Platform' });
  store.projects.set('WEB', { identifier: 'WEB', title: 'Web', description: 'kept' });
  return store;
}

describe('the data migration list is numbered 1..n', () => {
  describe('GIVEN DATA_MIGRATIONS', () => {
    describe('WHEN its versions are read', () => {
      let versions: number[];
      beforeEach(() => { versions = DATA_MIGRATIONS.map((m) => m.version); });

      it('THEN they are 1..n with no gaps or repeats', () => {
        expect(versions).toEqual(versions.map((_, i) => i + 1));
      });
    });
  });
});

describe('a data migration upgrades stored documents once and is recorded', () => {
  describe('GIVEN projects stored before description existed, and a migration that defaults it', () => {
    let store: any;
    let migration: ReturnType<typeof defaultDescription>;
    beforeEach(() => {
      store = oldProjects();
      migration = defaultDescription();
    });

    describe('WHEN the migrations are applied', () => {
      let applied: number[];
      beforeEach(() => { applied = applyDataMigrations(store, ctx, [migration]); });

      it('THEN version 1 is reported as applied', () => {
        expect(applied).toEqual([1]);
      });

      it('THEN the old document gets the default and an existing value is kept', () => {
        expect(store.projects.get('PRJ').description).toBe('');
        expect(store.projects.get('WEB').description).toBe('kept');
      });

      it('THEN the store records the version with its name and time', () => {
        expect(store.data_migrations['1']).toEqual({ name: 'project description defaults to empty', applied_at: NOW });
      });
    });
  });

  describe('GIVEN that migration already applied', () => {
    let store: any;
    let migration: ReturnType<typeof defaultDescription>;
    beforeEach(() => {
      store = oldProjects();
      migration = defaultDescription();
      applyDataMigrations(store, ctx, [migration]);
    });

    describe('WHEN the migrations are applied again', () => {
      let applied: number[];
      beforeEach(() => { applied = applyDataMigrations(store, ctx, [migration]); });

      it('THEN nothing is applied and the migration did not run again', () => {
        expect(applied).toEqual([]);
        expect(migration.runs).toBe(1);
      });
    });
  });
});

describe('data migrations run in version order and only the new ones run', () => {
  describe('GIVEN migrations listed out of order (2, 1, 3) and a store that already has 1', () => {
    let store: any;
    let calls: number[];
    beforeEach(() => {
      store = new MemoryStore();
      calls = [];
      applyDataMigrations(store, ctx, [marker(1, [])]);
    });

    describe('WHEN they are applied', () => {
      let applied: number[];
      beforeEach(() => { applied = applyDataMigrations(store, ctx, [marker(2, calls), marker(1, calls), marker(3, calls)]); });

      it('THEN 2 then 3 run, and 1 does not run again', () => {
        expect(calls).toEqual([2, 3]);
        expect(applied).toEqual([2, 3]);
      });
    });
  });
});

describe('a failing data migration is not recorded, so it runs again next time', () => {
  describe('GIVEN migration 1 that succeeds and migration 2 that throws', () => {
    let store: any;
    let migrations: DataMigration[];
    beforeEach(() => {
      store = new MemoryStore();
      migrations = [marker(1, []), { version: 2, name: 'broken', up: () => { throw new Error('boom'); } }];
    });

    describe('WHEN they are applied', () => {
      let error: any;
      beforeEach(() => { error = attempt(() => applyDataMigrations(store, ctx, migrations)); });

      it('THEN the error surfaces', () => {
        expect(String(error)).toContain('boom');
      });

      it('THEN 1 is recorded and 2 is not', () => {
        expect(Object.keys(store.data_migrations)).toEqual(['1']);
      });
    });
  });
});

describe('a store migrated by a newer application is refused', () => {
  describe('GIVEN a store that records data migration 3, and an application that knows 1 and 2', () => {
    let store: any;
    beforeEach(() => {
      store = new MemoryStore();
      store.data_migrations['3'] = { name: 'from the future', applied_at: NOW };
    });

    describe('WHEN the migrations are applied', () => {
      let apply: () => unknown;
      beforeEach(() => { apply = () => applyDataMigrations(store, ctx, [marker(1, []), marker(2, [])]); });

      it('THEN it refuses: the data is newer than the application', () => {
        expect(apply).toThrow(/newer/i);
      });
    });
  });
});

describe('applied data migrations are persisted with the data', () => {
  describe('GIVEN migration 1 applied to a SQLite store, committed and closed', () => {
    let file: string;
    beforeEach(() => {
      file = tmpDbFile();
      const store: any = SqliteStore.open(file);
      onCleanup(() => store.close());
      applyDataMigrations(store, ctx, [marker(1, [])]);
      store.commit();
      store.close();
    });

    describe('WHEN the file is reopened and the migrations applied again', () => {
      let calls: number[];
      let applied: number[];
      beforeEach(() => {
        const again: any = SqliteStore.open(file);
        onCleanup(() => again.close());
        calls = [];
        applied = applyDataMigrations(again, ctx, [marker(1, calls)]);
      });

      it('THEN nothing runs again', () => {
        expect(applied).toEqual([]);
        expect(calls).toEqual([]);
      });
    });
  });
});
