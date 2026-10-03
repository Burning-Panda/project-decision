import { describe, it, expect, beforeEach } from 'bun:test';
import { freshLog, proposedIn, proposed, act, expectCode, U, MEETING } from './support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.
// THEN may call read-only queries (listComments, listNotifications, ...) to observe the outcome.

const CONSENSUS = { mode: 'consensus_voting' };

/** Call inside a describe(): a proposed decision with a comment by bob; `c` is set before each test. */
function withBobsComment(content = 'first') {
  const h = proposedIn() as ReturnType<typeof proposedIn> & { c: any };
  beforeEach(() => { h.c = h.log.addComment(h.id, U.bob, { content }); });
  return h;
}

describe('anyone on the team can comment in any status; outsiders cannot', () => {
  describe('GIVEN an approved decision', () => {
    const h = proposedIn();
    beforeEach(() => { act(h.log, h.id, U.lead, 'approve'); });

    describe('WHEN bob adds a comment', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.bob, 'add_comment', { content: 'Has anyone tested rollback?' }); });

      it('THEN 201 with his unresolved comment', () => {
        expect(r.status_code).toBe(201);
        expect(r.data.comment.user).toBe(U.bob);
        expect(r.data.comment.resolved).toBe(false);
      });
    });

    describe('WHEN an outsider comments', () => {
      let comment: () => unknown;
      beforeEach(() => { comment = () => act(h.log, h.id, U.outsider, 'add_comment', { content: 'hi' }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(comment, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN bob comments with blank content', () => {
      let comment: () => unknown;
      beforeEach(() => { comment = () => act(h.log, h.id, U.bob, 'add_comment', { content: '   ' }); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(comment, 'VALIDATION_ERROR', 400);
      });
    });
  });
});

describe('comments are chronological, threaded and mention-aware', () => {
  /** A proposed decision with a first comment by alice, ten minutes ago; `c1` is set before each test. */
  function firstComment() {
    const h = proposedIn() as ReturnType<typeof proposedIn> & { c1: any };
    beforeEach(() => {
      h.c1 = h.log.addComment(h.id, U.alice, { content: 'Proposing PostgreSQL 16' });
      h.clock.advanceMinutes(10);
    });
    return h;
  }

  describe('GIVEN a first comment', () => {
    const h = firstComment();

    describe('WHEN bob replies mentioning @carol and @nobody', () => {
      let c2: any;
      beforeEach(() => { c2 = h.log.addComment(h.id, U.bob, { content: 'cc @carol and @nobody', parent_id: h.c1.id }); });

      it('THEN the reply is threaded and only carol is a mention', () => {
        expect(c2.parent_id).toBe(h.c1.id);
        expect(c2.mentions).toEqual([U.carol]);
      });

      it('THEN carol has a mention notification for the decision', () => {
        expect(h.log.listNotifications(U.carol).some((x: any) => x.type === 'mention' && x.decision_id === h.id)).toBe(true);
      });
    });

    describe('WHEN bob replies to a parent that does not exist', () => {
      let reply: () => unknown;
      beforeEach(() => { reply = () => h.log.addComment(h.id, U.bob, { content: 'x', parent_id: 'nope' }); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(reply, 'NOT_FOUND', 404);
      });
    });
  });

  describe('GIVEN a comment and a later reply', () => {
    const h = firstComment();
    let c2: any;
    beforeEach(() => { c2 = h.log.addComment(h.id, U.bob, { content: 'cc @carol and @nobody', parent_id: h.c1.id }); });

    describe('WHEN comments are listed', () => {
      let ids: string[];
      beforeEach(() => { ids = h.log.listComments(h.id, U.alice).map((c: any) => c.id); });

      it('THEN they are chronological', () => {
        expect(ids).toEqual([h.c1.id, c2.id]);
      });
    });
  });
});

describe('authors may edit within five minutes only', () => {
  describe('GIVEN bob\'s comment, 4 minutes old', () => {
    const h = withBobsComment();
    beforeEach(() => { h.clock.advanceMinutes(4); });

    describe('WHEN bob edits it', () => {
      let edited: any;
      beforeEach(() => { edited = h.log.editComment(h.id, h.c.id, U.bob, 'second'); });

      it('THEN the content changes and edited_at is set', () => {
        expect(edited.content).toBe('second');
        expect(edited.edited_at).toBeTruthy();
      });
    });

    describe('WHEN carol edits it', () => {
      let edit: () => unknown;
      beforeEach(() => { edit = () => h.log.editComment(h.id, h.c.id, U.carol, 'hijack'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(edit, 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN bob\'s comment, 6 minutes old', () => {
    const h = withBobsComment();
    beforeEach(() => { h.clock.advanceMinutes(6); });

    describe('WHEN bob edits it', () => {
      let edit: () => unknown;
      beforeEach(() => { edit = () => h.log.editComment(h.id, h.c.id, U.bob, 'too late'); });

      it('THEN EDIT_WINDOW_EXPIRED 403', () => {
        expectCode(edit, 'EDIT_WINDOW_EXPIRED', 403);
      });
    });
  });
});

describe('delete leaves a placeholder; authors and admins only', () => {
  describe('GIVEN bob\'s comment', () => {
    const h = withBobsComment('oops');

    describe('WHEN carol deletes it', () => {
      let remove: () => unknown;
      beforeEach(() => { remove = () => h.log.deleteComment(h.id, h.c.id, U.carol); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(remove, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the org admin deletes it', () => {
      let d: any;
      beforeEach(() => { d = h.log.deleteComment(h.id, h.c.id, U.org); });

      it('THEN a [deleted] placeholder with deleted_at remains', () => {
        expect(d.content).toBe('[deleted]');
        expect(d.deleted_at).toBeTruthy();
      });
    });

    describe('WHEN bob deletes it', () => {
      let d: any;
      beforeEach(() => { d = h.log.deleteComment(h.id, h.c.id, U.bob); });

      it('THEN a [deleted] placeholder remains', () => {
        expect(d.content).toBe('[deleted]');
      });
    });
  });

  describe('GIVEN a deleted comment', () => {
    const h = withBobsComment('oops');
    beforeEach(() => { h.log.deleteComment(h.id, h.c.id, U.org); });

    describe('WHEN comments are listed', () => {
      let comments: any[];
      beforeEach(() => { comments = h.log.listComments(h.id, U.alice); });

      it('THEN the placeholder is shown', () => {
        expect(comments[0].content).toBe('[deleted]');
      });
    });
  });
});

describe('comments can be resolved and re-opened', () => {
  describe('GIVEN an open comment', () => {
    const h = withBobsComment('question?');

    describe('WHEN alice resolves it', () => {
      let c: any;
      beforeEach(() => { c = h.log.resolveComment(h.id, h.c.id, U.alice); });

      it('THEN it is resolved', () => {
        expect(c.resolved).toBe(true);
      });
    });
  });

  describe('GIVEN a resolved comment', () => {
    const h = withBobsComment('question?');
    beforeEach(() => { h.log.resolveComment(h.id, h.c.id, U.alice); });

    describe('WHEN alice re-opens it', () => {
      let c: any;
      beforeEach(() => { c = h.log.resolveComment(h.id, h.c.id, U.alice, false); });

      it('THEN it is unresolved', () => {
        expect(c.resolved).toBe(false);
      });
    });
  });
});

describe('participants accumulate roles and actions', () => {
  describe('GIVEN bob commented, carol approved and david requested a revision', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => {
      h.log.addComment(h.id, U.bob, { content: 'question' });
      act(h.log, h.id, U.carol, 'vote', { vote: 'approve' });
      act(h.log, h.id, U.david, 'vote', { vote: 'request_revision', comment: 'docs' });
    });

    describe('WHEN participants are listed', () => {
      let by: Record<string, any>;
      beforeEach(() => { by = Object.fromEntries(h.log.getParticipants(h.id, U.alice).map((p: any) => [p.user, p])); });

      it('THEN the owner has exactly the owner role', () => {
        expect(by[U.alice].roles).toEqual(['owner']);
      });

      it('THEN bob is contributor and reviewer', () => {
        expect(by[U.bob].roles).toContain('contributor');
        expect(by[U.bob].roles).toContain('reviewer');
      });

      it('THEN carol is an approver and david a reviewer', () => {
        expect(by[U.carol].roles).toContain('approver');
        expect(by[U.david].roles).toContain('reviewer');
      });

      it('THEN bob has a timestamped commented action', () => {
        expect(by[U.bob].actions.some((a: any) => a.action_type === 'commented' && a.at)).toBe(true);
      });
    });
  });

  describe('GIVEN the lead declined a proposal', () => {
    const h = proposedIn();
    beforeEach(() => { act(h.log, h.id, U.lead, 'decline', { reason: 'no' }); });

    describe('WHEN participants are listed', () => {
      let lead: any;
      beforeEach(() => { lead = h.log.getParticipants(h.id, U.alice).find((p: any) => p.user === U.lead); });

      it('THEN the lead is a decliner', () => {
        expect(lead.roles).toContain('decliner');
      });
    });
  });
});

describe('meeting records store a transcript and render the documented notes format', () => {
  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN bob adds a meeting', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.bob, 'add_meeting', MEETING); });

      it('THEN 201 and the transcript text contains the spoken lines', () => {
        expect(r.status_code).toBe(201);
        expect(r.data.meeting.transcript_text).toContain('Rollback worries me.');
      });

      it('THEN bob has a recorded_meeting action', () => {
        const bob = h.log.getParticipants(h.id, U.alice).find((p: any) => p.user === U.bob);
        expect(bob.actions.some((a: any) => a.action_type === 'recorded_meeting')).toBe(true);
      });
    });
  });

  describe('GIVEN a recorded meeting with out-of-order segments and key takeaways', () => {
    const h = proposedIn();
    beforeEach(() => { act(h.log, h.id, U.bob, 'add_meeting', MEETING); });

    describe('WHEN notes are rendered', () => {
      let md: string;
      beforeEach(() => { md = h.log.renderMeetingNotes(h.id, U.alice); });

      it('THEN the heading, duration, attendees and recording appear', () => {
        expect(md).toMatch(/## Meeting Records/);
        expect(md).toMatch(/### Meeting: 2024-03-21 15:00 - 00:03:10/);
        expect(md).toMatch(/\*\*Attendees\*\*: alice@acme.com, bob@acme.com/);
        expect(md).toMatch(/\*\*Recording\*\*: s3:\/\/bucket\/m1.webm/);
      });

      it('THEN transcript lines are time-ordered with timestamps and speakers', () => {
        expect(md.split('\n').filter((l) => l.startsWith('['))).toEqual([
          '[00:00:00] **Alice**: Let us start.',
          '[00:00:45] **Bob**: Rollback worries me.',
          '[00:02:10] **Alice**: We add a dual-write period.',
        ]);
      });

      it('THEN key takeaways are listed as bullets', () => {
        expect(md).toMatch(/- Add dual-write period/);
      });
    });
  });
});

describe('meeting needs a transcript', () => {
  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN bob adds a meeting without segments or transcript', () => {
      let add: () => unknown;
      beforeEach(() => { add = () => act(h.log, h.id, U.bob, 'add_meeting', { duration_seconds: 5 }); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(add, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN an outsider adds a meeting', () => {
      let add: () => unknown;
      beforeEach(() => { add = () => act(h.log, h.id, U.outsider, 'add_meeting', MEETING); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(add, 'FORBIDDEN', 403);
      });
    });
  });
});

describe('notifications: proposing notifies the team; votes notify the owner when enabled', () => {
  describe('GIVEN consensus mode', () => {
    const h = freshLog(CONSENSUS);

    describe('WHEN alice proposes', () => {
      let id: string;
      beforeEach(() => { id = proposed(h.log); });

      it('THEN bob is notified that the decision was proposed', () => {
        expect(h.log.listNotifications(U.bob).some((n: any) => n.type === 'decision_proposed' && n.decision_id === id)).toBe(true);
      });

      it('THEN alice herself is not notified', () => {
        expect(h.log.listNotifications(U.alice).some((n: any) => n.type === 'decision_proposed')).toBe(false);
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    const h = proposedIn(CONSENSUS);

    describe('WHEN bob votes', () => {
      beforeEach(() => { act(h.log, h.id, U.bob, 'vote', { vote: 'approve' }); });

      it('THEN the owner gets a vote_received notification', () => {
        expect(h.log.listNotifications(U.alice).some((n: any) => n.type === 'vote_received')).toBe(true);
      });
    });
  });
});

describe('notification_on_vote=false suppresses vote notifications', () => {
  describe('GIVEN notification_on_vote=false and a proposed decision', () => {
    const h = proposedIn({ ...CONSENSUS, notification_on_vote: false });

    describe('WHEN bob votes', () => {
      beforeEach(() => { act(h.log, h.id, U.bob, 'vote', { vote: 'approve' }); });

      it('THEN the owner gets no vote_received notification', () => {
        expect(h.log.listNotifications(U.alice).some((n: any) => n.type === 'vote_received')).toBe(false);
      });
    });
  });
});
