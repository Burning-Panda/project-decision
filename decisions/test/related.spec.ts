import { describe, it, expect } from 'bun:test';
import { setup, draft, act, expectCode, U } from './support/index.js';

const PG = 'Migrate production database from MySQL to PostgreSQL 16. Performance benchmarks, replication and rollback plan for the database migration.';
const PG2 = 'Migrate the production database from MySQL to PostgreSQL 16. Benchmarks for performance, replication and a rollback plan for database migration.';
const COFFEE = 'Buy a new espresso machine for the office kitchen and pick a coffee supplier.';

// Finder that suggests PRJ-001 for PRJ-002 only
const suggestFirstFor = (type: string, score: number) => (d: any) =>
  (d.id === 'PRJ-002' ? [{ decision_id: 'PRJ-001', type, score }] : []);

describe('default finder links near-duplicate decisions and ignores unrelated ones', () => {
  async function three() {
    const { log } = await setup();
    const a = draft(log, { title: 'Database migration', content: PG });
    const b = draft(log, { title: 'Database migration plan', content: PG2 });
    const c = draft(log, { title: 'Office coffee', content: COFFEE });
    return { log, a, b, c };
  }

  describe('GIVEN two near-duplicate decisions', () => {
    describe('WHEN the newer one\'s related links are read', () => {
      it('THEN exactly one AI-identified link to the older one exists', async () => {
        const { log, a, b } = await three();
        const rel = log.getRelated(b.id, U.alice);
        expect(rel.length).toBe(1);
        expect(rel[0].related_decision_id).toBe(a.id);
        expect(rel[0].ai_identified).toBe(true);
        expect(rel[0].type).toBe('related');
      });
    });
  });

  describe('GIVEN a near-duplicate link', () => {
    describe('WHEN its confidence is read', () => {
      it('THEN it is between 60 and 100', async () => {
        const { log, b } = await three();
        const rel = log.getRelated(b.id, U.alice);
        expect(rel[0].confidence_score).toBeGreaterThanOrEqual(60);
        expect(rel[0].confidence_score).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('GIVEN an unrelated coffee decision', () => {
    describe('WHEN its related links are read', () => {
      it('THEN there are none', async () => {
        const { log, c } = await three();
        expect(log.getRelated(c.id, U.alice)).toEqual([]);
      });
    });
  });
});

describe('injected finder results are filtered by the confidence threshold', () => {
  describe('GIVEN a finder returning scores 92 and 40 and a threshold of 60', () => {
    describe('WHEN the third decision is drafted', () => {
      it('THEN only the 92 conflict is linked', async () => {
        // Given
        const finder = () => [
          { decision_id: 'PRJ-001', type: 'conflicts', score: 92 },
          { decision_id: 'PRJ-002', type: 'complements', score: 40 },
        ];
        const { log } = await setup({ finder, threshold: 60 });
        draft(log); draft(log);
        // When
        const third = draft(log);
        // Then
        const rel = log.getRelated(third.id, U.alice);
        expect(rel.map((r: any) => [r.related_decision_id, r.type, r.confidence_score])).toEqual([['PRJ-001', 'conflicts', 92]]);
      });
    });
  });
});

describe('finder runs on create, draft save and propose', () => {
  async function counted() {
    const calls = { n: 0 };
    const { log } = await setup({ finder: () => { calls.n++; return []; } });
    return { log, calls };
  }

  describe('GIVEN a counting finder', () => {
    describe('WHEN a decision is created', () => {
      it('THEN the finder ran once', async () => {
        const { log, calls } = await counted();
        draft(log);
        expect(calls.n).toBe(1);
      });
    });
  });

  describe('GIVEN a created decision', () => {
    describe('WHEN the draft is saved', () => {
      it('THEN the finder ran a second time', async () => {
        const { log, calls } = await counted();
        const d = draft(log);
        log.updateDraft(d.id, U.alice, { content: 'changed' });
        expect(calls.n).toBe(2);
      });
    });
  });

  describe('GIVEN a created and saved draft', () => {
    describe('WHEN it is proposed', () => {
      it('THEN the finder ran a third time', async () => {
        const { log, calls } = await counted();
        const d = draft(log);
        log.updateDraft(d.id, U.alice, { content: 'changed' });
        act(log, d.id, U.alice, 'propose');
        expect(calls.n).toBe(3);
      });
    });
  });
});

describe('rescans do not duplicate suggestions or resurrect dismissed ones', () => {
  async function secondWithSuggestion() {
    const { log } = await setup({ finder: suggestFirstFor('related', 80) });
    draft(log);
    const b = draft(log);
    return { log, b };
  }

  describe('GIVEN a suggestion', () => {
    describe('WHEN the draft is saved again', () => {
      it('THEN there is still one suggestion', async () => {
        const { log, b } = await secondWithSuggestion();
        log.updateDraft(b.id, U.alice, { content: 'again' });
        expect(log.getRelated(b.id, U.alice).length).toBe(1);
      });
    });
  });

  describe('GIVEN a dismissed suggestion', () => {
    describe('WHEN the decision is proposed (rescan)', () => {
      it('THEN it is not resurrected', async () => {
        // Given
        const { log, b } = await secondWithSuggestion();
        log.reviewRelated(b.id, 'PRJ-001', U.alice, 'dismiss');
        // When
        act(log, b.id, U.alice, 'propose');
        // Then
        expect(log.getRelated(b.id, U.alice).length).toBe(0);
      });
    });
    describe('WHEN related links are read including dismissed', () => {
      it('THEN it is still listed once', async () => {
        const { log, b } = await secondWithSuggestion();
        log.reviewRelated(b.id, 'PRJ-001', U.alice, 'dismiss');
        act(log, b.id, U.alice, 'propose');
        expect(log.getRelated(b.id, U.alice, { includeDismissed: true }).length).toBe(1);
      });
    });
  });
});

describe('suggestions can be confirmed; manual links record their type', () => {
  async function ctx() {
    const { log } = await setup({ finder: suggestFirstFor('related', 80) });
    draft(log);
    const b = draft(log);
    const c = draft(log);
    return { log, b, c };
  }

  describe('GIVEN an AI suggestion', () => {
    describe('WHEN bob confirms it', () => {
      it('THEN its status is confirmed', async () => {
        const { log, b } = await ctx();
        expect(log.reviewRelated(b.id, 'PRJ-001', U.bob, 'confirm').status).toBe('confirmed');
      });
    });
  });

  describe('GIVEN a decision', () => {
    describe('WHEN bob links PRJ-001 as complements', () => {
      it('THEN the link is manual, 100% confidence and created by bob', async () => {
        // Given
        const { log, c } = await ctx();
        // When
        const m = log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-001', type: 'complements' });
        // Then
        expect(m.ai_identified).toBe(false);
        expect(m.confidence_score).toBe(100);
        expect(m.created_by).toBe(U.bob);
      });
    });
    describe('WHEN bob links with an unknown type', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log, c } = await ctx();
        expectCode(() => log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-001', type: 'friends' }), 'VALIDATION_ERROR', 400);
      });
    });
    describe('WHEN bob links a decision that does not exist', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log, c } = await ctx();
        expectCode(() => log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-404', type: 'related' }), 'NOT_FOUND', 404);
      });
    });
    describe('WHEN an outsider adds a link', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, c } = await ctx();
        expectCode(() => log.addRelated(c.id, U.outsider, { related_decision_id: 'PRJ-001', type: 'related' }), 'FORBIDDEN', 403);
      });
    });
  });
});

describe('rendered document lists related decisions with type and match percent', () => {
  describe('GIVEN a 92% conflicts suggestion', () => {
    describe('WHEN the document is rendered', () => {
      it('THEN a Related Decisions entry shows title, type and percent', async () => {
        // Given
        const { log } = await setup({ finder: suggestFirstFor('conflicts', 92) });
        draft(log, { title: 'Database platform selection' });
        const b = draft(log);
        // When
        const md = log.renderDecisionDocument(b.id, U.alice);
        // Then
        expect(md).toMatch(/## Related Decisions/);
        expect(md).toMatch(/\*\*PRJ-001: Database platform selection\*\* - \*Conflicts\* \(92% match\)/);
      });
    });
  });
});

describe('links are visible from both sides, with direction', () => {
  async function conflict() {
    const { log } = await setup({ finder: suggestFirstFor('conflicts', 90) });
    draft(log, { title: 'Older' });
    const b = draft(log, { title: 'Newer' });
    return { log, b };
  }

  describe('GIVEN a link from the newer decision', () => {
    describe('WHEN the newer side is read', () => {
      it('THEN the link is outgoing', async () => {
        const { log, b } = await conflict();
        expect(log.getRelated(b.id, U.alice)[0].direction).toBe('outgoing');
      });
    });
    describe('WHEN the older side is read', () => {
      it('THEN the link is incoming with the newer title and type', async () => {
        const { log } = await conflict();
        const incoming = log.getRelated('PRJ-001', U.alice);
        expect(incoming.length).toBe(1);
        expect(incoming[0].related_decision_id).toBe('PRJ-002');
        expect(incoming[0].direction).toBe('incoming');
        expect(incoming[0].related_title).toBe('Newer');
        expect(incoming[0].type).toBe('conflicts');
      });
    });
  });

  describe('GIVEN a link', () => {
    describe('WHEN the newer side dismisses it', () => {
      it('THEN the incoming side no longer shows it', async () => {
        const { log, b } = await conflict();
        log.reviewRelated(b.id, 'PRJ-001', U.alice, 'dismiss');
        expect(log.getRelated('PRJ-001', U.alice).length).toBe(0);
      });
    });
  });
});

describe('decision ids mentioned in the document are linked automatically', () => {
  async function mentioning() {
    const { log } = await setup({ finder: () => [] });
    draft(log, { title: 'Database platform selection' });
    const b = draft(log, { content: 'This builds on PRJ-001 and ignores PRJ-777 and itself (PRJ-002).' });
    return { log, b };
  }

  describe('GIVEN a document mentioning PRJ-001, PRJ-777 and itself', () => {
    describe('WHEN related links are read', () => {
      it('THEN only PRJ-001 is linked', async () => {
        const { log, b } = await mentioning();
        expect(log.getRelated(b.id, U.alice).map((r: any) => r.related_decision_id)).toEqual(['PRJ-001']);
      });
    });
  });

  describe('GIVEN a mention-derived link', () => {
    describe('WHEN its attributes are read', () => {
      it('THEN it is a related, 100% confidence, non-AI link', async () => {
        const { log, b } = await mentioning();
        const rel = log.getRelated(b.id, U.alice);
        expect(rel[0].type).toBe('related');
        expect(rel[0].confidence_score).toBe(100);
        expect(rel[0].ai_identified).toBe(false);
      });
    });
    describe('WHEN the draft is rescanned with PRJ-001 mentioned twice', () => {
      it('THEN there is no duplicate', async () => {
        const { log, b } = await mentioning();
        log.updateDraft(b.id, U.alice, { content: 'Now also mentions PRJ-001 twice PRJ-001' });
        expect(log.getRelated(b.id, U.alice).length).toBe(1);
      });
    });
  });
});

describe('incoming notification: owners are told when a new decision relates to theirs', () => {
  async function bobsAndCarols() {
    const { log } = await setup({ finder: suggestFirstFor('related', 80) });
    draft(log, { actor: U.bob });
    draft(log, { actor: U.carol });
    return log;
  }

  describe('GIVEN bob owns PRJ-001', () => {
    describe('WHEN a related PRJ-002 is created', () => {
      it('THEN bob gets a related_decision notification for PRJ-001', async () => {
        const log = await bobsAndCarols();
        expect(log.listNotifications(U.bob).some((n: any) => n.type === 'related_decision' && n.decision_id === 'PRJ-001')).toBe(true);
      });
    });
  });

  describe('GIVEN carol owns the new PRJ-002', () => {
    describe('WHEN it relates to bob\'s decision', () => {
      it('THEN carol gets no related_decision notification', async () => {
        const log = await bobsAndCarols();
        expect(log.listNotifications(U.carol).some((n: any) => n.type === 'related_decision')).toBe(false);
      });
    });
  });
});
