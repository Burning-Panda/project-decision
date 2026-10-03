import { describe, it, expect, beforeEach } from 'bun:test';
import { freshLog, draft, act, expectCode, U, type LogHandle } from './support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.
// THEN may call read-only queries (getRelated, listNotifications, ...) to observe the outcome.

const PG = 'Migrate production database from MySQL to PostgreSQL 16. Performance benchmarks, replication and rollback plan for the database migration.';
const PG2 = 'Migrate the production database from MySQL to PostgreSQL 16. Benchmarks for performance, replication and a rollback plan for database migration.';
const COFFEE = 'Buy a new espresso machine for the office kitchen and pick a coffee supplier.';

// Finder that suggests PRJ-001 for PRJ-002 only
const suggestFirstFor = (type: string, score: number) => (d: any) =>
  (d.id === 'PRJ-002' ? [{ decision_id: 'PRJ-001', type, score }] : []);

/** Call inside a describe(): a fresh log using a finder that suggests PRJ-001 for PRJ-002, with PRJ-001 and PRJ-002 drafted; `b` is PRJ-002. */
function suggested(type = 'related', score = 80) {
  const h = freshLog({ finder: suggestFirstFor(type, score) }) as LogHandle & { b: any };
  beforeEach(() => {
    draft(h.log, { title: 'Older' });
    h.b = draft(h.log, { title: 'Newer' });
  });
  return h;
}

describe('default finder links near-duplicate decisions and ignores unrelated ones', () => {
  describe('GIVEN two near-duplicate decisions and an unrelated coffee decision', () => {
    const h = freshLog();
    let a: any, b: any, c: any;
    beforeEach(() => {
      a = draft(h.log, { title: 'Database migration', content: PG });
      b = draft(h.log, { title: 'Database migration plan', content: PG2 });
      c = draft(h.log, { title: 'Office coffee', content: COFFEE });
    });

    describe('WHEN the newer near-duplicate\'s related links are read', () => {
      let rel: any[];
      beforeEach(() => { rel = h.log.getRelated(b.id, U.alice); });

      it('THEN exactly one AI-identified link to the older one exists', () => {
        expect(rel.length).toBe(1);
        expect(rel[0].related_decision_id).toBe(a.id);
        expect(rel[0].ai_identified).toBe(true);
        expect(rel[0].type).toBe('related');
      });

      it('THEN its confidence is between 60 and 100', () => {
        expect(rel[0].confidence_score).toBeGreaterThanOrEqual(60);
        expect(rel[0].confidence_score).toBeLessThanOrEqual(100);
      });
    });

    describe('WHEN the coffee decision\'s related links are read', () => {
      let rel: any[];
      beforeEach(() => { rel = h.log.getRelated(c.id, U.alice); });

      it('THEN there are none', () => {
        expect(rel).toEqual([]);
      });
    });
  });
});

describe('injected finder results are filtered by the confidence threshold', () => {
  describe('GIVEN a finder returning scores 92 and 40, a threshold of 60 and two decisions', () => {
    const finder = () => [
      { decision_id: 'PRJ-001', type: 'conflicts', score: 92 },
      { decision_id: 'PRJ-002', type: 'complements', score: 40 },
    ];
    const h = freshLog({ finder, threshold: 60 });
    beforeEach(() => { draft(h.log); draft(h.log); });

    describe('WHEN the third decision is drafted', () => {
      let third: any;
      beforeEach(() => { third = draft(h.log); });

      it('THEN only the 92 conflict is linked', () => {
        const rel = h.log.getRelated(third.id, U.alice);
        expect(rel.map((r: any) => [r.related_decision_id, r.type, r.confidence_score])).toEqual([['PRJ-001', 'conflicts', 92]]);
      });
    });
  });
});

describe('finder runs on create, draft save and propose', () => {
  /** Call inside a describe(): a fresh log whose finder counts its calls in `calls.n` (reset per test). */
  function counting() {
    const calls = { n: 0 };
    beforeEach(() => { calls.n = 0; });
    const h = freshLog({ finder: () => { calls.n++; return []; } });
    return { h, calls };
  }

  describe('GIVEN a counting finder', () => {
    const { h, calls } = counting();

    describe('WHEN a decision is created', () => {
      beforeEach(() => { draft(h.log); });

      it('THEN the finder ran once', () => {
        expect(calls.n).toBe(1);
      });
    });
  });

  describe('GIVEN a created decision', () => {
    const { h, calls } = counting();
    let id: string;
    beforeEach(() => { id = draft(h.log).id; });

    describe('WHEN the draft is saved', () => {
      beforeEach(() => { h.log.updateDraft(id, U.alice, { content: 'changed' }); });

      it('THEN the finder ran a second time', () => {
        expect(calls.n).toBe(2);
      });
    });
  });

  describe('GIVEN a created and saved draft', () => {
    const { h, calls } = counting();
    let id: string;
    beforeEach(() => {
      id = draft(h.log).id;
      h.log.updateDraft(id, U.alice, { content: 'changed' });
    });

    describe('WHEN it is proposed', () => {
      beforeEach(() => { act(h.log, id, U.alice, 'propose'); });

      it('THEN the finder ran a third time', () => {
        expect(calls.n).toBe(3);
      });
    });
  });
});

describe('rescans do not duplicate suggestions or resurrect dismissed ones', () => {
  describe('GIVEN a suggestion', () => {
    const h = suggested();

    describe('WHEN the draft is saved again', () => {
      beforeEach(() => { h.log.updateDraft(h.b.id, U.alice, { content: 'again' }); });

      it('THEN there is still one suggestion', () => {
        expect(h.log.getRelated(h.b.id, U.alice).length).toBe(1);
      });
    });
  });

  describe('GIVEN a dismissed suggestion', () => {
    const h = suggested();
    beforeEach(() => { h.log.reviewRelated(h.b.id, 'PRJ-001', U.alice, 'dismiss'); });

    describe('WHEN the decision is proposed (rescan)', () => {
      beforeEach(() => { act(h.log, h.b.id, U.alice, 'propose'); });

      it('THEN it is not resurrected', () => {
        expect(h.log.getRelated(h.b.id, U.alice).length).toBe(0);
      });

      it('THEN it is still listed once when dismissed links are included', () => {
        expect(h.log.getRelated(h.b.id, U.alice, { includeDismissed: true }).length).toBe(1);
      });
    });
  });
});

describe('suggestions can be confirmed; manual links record their type', () => {
  describe('GIVEN an AI suggestion', () => {
    const h = suggested();

    describe('WHEN bob confirms it', () => {
      let link: any;
      beforeEach(() => { link = h.log.reviewRelated(h.b.id, 'PRJ-001', U.bob, 'confirm'); });

      it('THEN its status is confirmed', () => {
        expect(link.status).toBe('confirmed');
      });
    });
  });

  describe('GIVEN a third decision without suggestions', () => {
    const h = suggested();
    let c: any;
    beforeEach(() => { c = draft(h.log); });

    describe('WHEN bob links PRJ-001 as complements', () => {
      let m: any;
      beforeEach(() => { m = h.log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-001', type: 'complements' }); });

      it('THEN the link is manual, 100% confidence and created by bob', () => {
        expect(m.ai_identified).toBe(false);
        expect(m.confidence_score).toBe(100);
        expect(m.created_by).toBe(U.bob);
      });
    });

    describe('WHEN bob links with an unknown type', () => {
      let link: () => unknown;
      beforeEach(() => { link = () => h.log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-001', type: 'friends' }); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(link, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN bob links a decision that does not exist', () => {
      let link: () => unknown;
      beforeEach(() => { link = () => h.log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-404', type: 'related' }); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(link, 'NOT_FOUND', 404);
      });
    });

    describe('WHEN an outsider adds a link', () => {
      let link: () => unknown;
      beforeEach(() => { link = () => h.log.addRelated(c.id, U.outsider, { related_decision_id: 'PRJ-001', type: 'related' }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(link, 'FORBIDDEN', 403);
      });
    });
  });
});

describe('rendered document lists related decisions with type and match percent', () => {
  describe('GIVEN a 92% conflicts suggestion', () => {
    const h = freshLog({ finder: suggestFirstFor('conflicts', 92) });
    let b: any;
    beforeEach(() => {
      draft(h.log, { title: 'Database platform selection' });
      b = draft(h.log);
    });

    describe('WHEN the document is rendered', () => {
      let md: string;
      beforeEach(() => { md = h.log.renderDecisionDocument(b.id, U.alice); });

      it('THEN a Related Decisions entry shows title, type and percent', () => {
        expect(md).toMatch(/## Related Decisions/);
        expect(md).toMatch(/\*\*PRJ-001: Database platform selection\*\* - \*Conflicts\* \(92% match\)/);
      });
    });
  });
});

describe('links are visible from both sides, with direction', () => {
  describe('GIVEN a conflicts link from the newer decision', () => {
    const h = suggested('conflicts', 90);

    describe('WHEN the newer side is read', () => {
      let rel: any[];
      beforeEach(() => { rel = h.log.getRelated(h.b.id, U.alice); });

      it('THEN the link is outgoing', () => {
        expect(rel[0].direction).toBe('outgoing');
      });
    });

    describe('WHEN the older side is read', () => {
      let incoming: any[];
      beforeEach(() => { incoming = h.log.getRelated('PRJ-001', U.alice); });

      it('THEN the link is incoming with the newer title and type', () => {
        expect(incoming.length).toBe(1);
        expect(incoming[0].related_decision_id).toBe('PRJ-002');
        expect(incoming[0].direction).toBe('incoming');
        expect(incoming[0].related_title).toBe('Newer');
        expect(incoming[0].type).toBe('conflicts');
      });
    });

    describe('WHEN the newer side dismisses it', () => {
      beforeEach(() => { h.log.reviewRelated(h.b.id, 'PRJ-001', U.alice, 'dismiss'); });

      it('THEN the incoming side no longer shows it', () => {
        expect(h.log.getRelated('PRJ-001', U.alice).length).toBe(0);
      });
    });
  });
});

describe('decision ids mentioned in the document are linked automatically', () => {
  describe('GIVEN a document mentioning PRJ-001, PRJ-777 and itself', () => {
    const h = freshLog({ finder: () => [] });
    let b: any;
    beforeEach(() => {
      draft(h.log, { title: 'Database platform selection' });
      b = draft(h.log, { content: 'This builds on PRJ-001 and ignores PRJ-777 and itself (PRJ-002).' });
    });

    describe('WHEN related links are read', () => {
      let rel: any[];
      beforeEach(() => { rel = h.log.getRelated(b.id, U.alice); });

      it('THEN only PRJ-001 is linked', () => {
        expect(rel.map((r: any) => r.related_decision_id)).toEqual(['PRJ-001']);
      });

      it('THEN it is a related, 100% confidence, non-AI link', () => {
        expect(rel[0].type).toBe('related');
        expect(rel[0].confidence_score).toBe(100);
        expect(rel[0].ai_identified).toBe(false);
      });
    });

    describe('WHEN the draft is rescanned with PRJ-001 mentioned twice', () => {
      beforeEach(() => { h.log.updateDraft(b.id, U.alice, { content: 'Now also mentions PRJ-001 twice PRJ-001' }); });

      it('THEN there is no duplicate', () => {
        expect(h.log.getRelated(b.id, U.alice).length).toBe(1);
      });
    });
  });
});

describe('incoming notification: owners are told when a new decision relates to theirs', () => {
  describe('GIVEN bob owns PRJ-001', () => {
    const h = freshLog({ finder: suggestFirstFor('related', 80) });
    beforeEach(() => { draft(h.log, { actor: U.bob }); });

    describe('WHEN carol creates PRJ-002, which relates to it', () => {
      beforeEach(() => { draft(h.log, { actor: U.carol }); });

      it('THEN bob gets a related_decision notification for PRJ-001', () => {
        expect(h.log.listNotifications(U.bob).some((n: any) => n.type === 'related_decision' && n.decision_id === 'PRJ-001')).toBe(true);
      });

      it('THEN carol, the new decision\'s owner, gets none', () => {
        expect(h.log.listNotifications(U.carol).some((n: any) => n.type === 'related_decision')).toBe(false);
      });
    });
  });
});
