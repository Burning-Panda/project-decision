import { describe, it, expect, beforeEach } from 'bun:test';
import { OwnersService, TeamsService, partsSetup, expectCode } from './support/index';

type Parts = Awaited<ReturnType<typeof partsSetup>>;

/** Registers a beforeEach that boots the parts and exposes the owners service on the returned handle. */
function owning() {
  const h = {} as { owners: OwnersService; get: Parts['get'] };
  beforeEach(async () => {
    const { get } = await partsSetup();
    h.get = get;
    h.owners = get(OwnersService);
  });
  return h;
}

describe('OwnersService.create', () => {
  describe('GIVEN no owners', () => {
    const h = owning();

    describe('WHEN acme is created with name and email', () => {
      let owner: any;
      beforeEach(() => { owner = h.owners.create({ identifier: 'acme', name: 'Acme Inc', email: 'root@acme.com' }); });

      it('THEN the record carries them with matching timestamps', () => {
        expect(owner).toMatchObject({ identifier: 'acme', name: 'Acme Inc', email: 'root@acme.com' });
        expect(owner.created_at).toBe(owner.updated_at);
      });
      it('THEN an empty default team exists for it', () => {
        expect(h.get(TeamsService).get('acme').members).toEqual([]);
      });
    });

    describe('WHEN acme is created with only an identifier', () => {
      let owner: any;
      beforeEach(() => { owner = h.owners.create({ identifier: 'acme' }); });

      it('THEN name falls back to the identifier and email is null', () => {
        expect(owner.name).toBe('acme');
        expect(owner.email).toBeNull();
      });
    });

    describe('WHEN an owner is created without an identifier', () => {
      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(() => h.owners.create({}), 'VALIDATION_ERROR', 400);
      });
    });
  });

  describe('GIVEN acme exists', () => {
    const h = owning();
    beforeEach(() => { h.owners.create({ identifier: 'acme' }); });

    describe('WHEN acme is created again', () => {
      it('THEN CONFLICT 409', () => {
        expectCode(() => h.owners.create({ identifier: 'acme' }), 'CONFLICT', 409);
      });
    });

    describe('WHEN acme is required', () => {
      it('THEN it is returned', () => {
        expect(h.owners.require('acme').identifier).toBe('acme');
      });
    });

    describe('WHEN an unknown owner is required', () => {
      it('THEN NOT_FOUND 404', () => {
        expectCode(() => h.owners.require('nobody'), 'NOT_FOUND', 404);
      });
    });
  });
});
