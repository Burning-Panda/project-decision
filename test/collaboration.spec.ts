import { describe, it, expect } from 'bun:test';
import { setup, proposed, act, expectCode, U, MEETING } from './support/index';

describe('anyone on the team can comment in any status; outsiders cannot', () => {
  async function approvedDecision() {
    const { log } = await setup();
    const id = proposed(log);
    act(log, id, U.lead, 'approve');
    return { log, id };
  }

  describe('GIVEN an approved decision', () => {
    describe('WHEN bob adds a comment', () => {
      it('THEN 201 with his unresolved comment', async () => {
        // Given
        const { log, id } = await approvedDecision();
        // When
        const r = act(log, id, U.bob, 'add_comment', { content: 'Has anyone tested rollback?' });
        // Then
        expect(r.status_code).toBe(201);
        expect(r.data.comment.user).toBe(U.bob);
        expect(r.data.comment.resolved).toBe(false);
      });
    });
    describe('WHEN an outsider comments', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, id } = await approvedDecision();
        expectCode(() => act(log, id, U.outsider, 'add_comment', { content: 'hi' }), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN bob comments with blank content', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log, id } = await approvedDecision();
        expectCode(() => act(log, id, U.bob, 'add_comment', { content: '   ' }), 'VALIDATION_ERROR', 400);
      });
    });
  });
});

describe('comments are chronological, threaded and mention-aware', () => {
  async function threaded() {
    const { log, clock } = await setup();
    const id = proposed(log);
    const c1 = log.addComment(id, U.alice, { content: 'Proposing PostgreSQL 16' });
    clock.advanceMinutes(10);
    return { log, id, c1 };
  }

  describe('GIVEN a first comment', () => {
    describe('WHEN bob replies mentioning @carol and @nobody', () => {
      it('THEN the reply is threaded and only carol is a mention', async () => {
        // Given
        const { log, id, c1 } = await threaded();
        // When
        const c2 = log.addComment(id, U.bob, { content: 'cc @carol and @nobody', parent_id: c1.id });
        // Then
        expect(c2.parent_id).toBe(c1.id);
        expect(c2.mentions).toEqual([U.carol]);
      });
    });
  });

  describe('GIVEN a comment and a later reply', () => {
    describe('WHEN comments are listed', () => {
      it('THEN they are chronological', async () => {
        // Given
        const { log, id, c1 } = await threaded();
        const c2 = log.addComment(id, U.bob, { content: 'cc @carol and @nobody', parent_id: c1.id });
        // When
        const ids = log.listComments(id, U.alice).map((c: any) => c.id);
        // Then
        expect(ids).toEqual([c1.id, c2.id]);
      });
    });
  });

  describe('GIVEN a decision', () => {
    describe('WHEN bob replies to a parent that does not exist', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log, id } = await threaded();
        expectCode(() => log.addComment(id, U.bob, { content: 'x', parent_id: 'nope' }), 'NOT_FOUND', 404);
      });
    });
  });

  describe('GIVEN a reply mentioning @carol', () => {
    describe('WHEN carol lists her notifications', () => {
      it('THEN she has a mention for the decision', async () => {
        // Given
        const { log, id, c1 } = await threaded();
        // When
        log.addComment(id, U.bob, { content: 'cc @carol and @nobody', parent_id: c1.id });
        // Then
        expect(log.listNotifications(U.carol).some((x: any) => x.type === 'mention' && x.decision_id === id)).toBe(true);
      });
    });
  });
});

describe('authors may edit within five minutes only', () => {
  async function bobsComment() {
    const { log, clock } = await setup();
    const id = proposed(log);
    const c = log.addComment(id, U.bob, { content: 'first' });
    return { log, clock, id, c };
  }

  describe('GIVEN a comment 4 minutes old', () => {
    describe('WHEN its author edits it', () => {
      it('THEN the content changes and edited_at is set', async () => {
        // Given
        const { log, clock, id, c } = await bobsComment();
        clock.advanceMinutes(4);
        // When
        const edited = log.editComment(id, c.id, U.bob, 'second');
        // Then
        expect(edited.content).toBe('second');
        expect(edited.edited_at).toBeTruthy();
      });
    });
  });

  describe('GIVEN bob\'s comment', () => {
    describe('WHEN carol edits it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, clock, id, c } = await bobsComment();
        clock.advanceMinutes(4);
        expectCode(() => log.editComment(id, c.id, U.carol, 'hijack'), 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN a comment 6 minutes old', () => {
    describe('WHEN its author edits it', () => {
      it('THEN EDIT_WINDOW_EXPIRED 403', async () => {
        const { log, clock, id, c } = await bobsComment();
        clock.advanceMinutes(6);
        expectCode(() => log.editComment(id, c.id, U.bob, 'too late'), 'EDIT_WINDOW_EXPIRED', 403);
      });
    });
  });
});

describe('delete leaves a placeholder; authors and admins only', () => {
  async function bobsComment() {
    const { log } = await setup();
    const id = proposed(log);
    return { log, id, c: log.addComment(id, U.bob, { content: 'oops' }) };
  }

  describe('GIVEN bob\'s comment', () => {
    describe('WHEN carol deletes it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, id, c } = await bobsComment();
        expectCode(() => log.deleteComment(id, c.id, U.carol), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the org admin deletes it', () => {
      it('THEN a [deleted] placeholder with deleted_at remains', async () => {
        // Given
        const { log, id, c } = await bobsComment();
        // When
        const d = log.deleteComment(id, c.id, U.org);
        // Then
        expect(d.content).toBe('[deleted]');
        expect(d.deleted_at).toBeTruthy();
      });
    });
  });

  describe('GIVEN a deleted comment', () => {
    describe('WHEN comments are listed', () => {
      it('THEN the placeholder is shown', async () => {
        const { log, id, c } = await bobsComment();
        log.deleteComment(id, c.id, U.org);
        expect(log.listComments(id, U.alice)[0].content).toBe('[deleted]');
      });
    });
  });

  describe('GIVEN bob\'s own comment', () => {
    describe('WHEN bob deletes it', () => {
      it('THEN a [deleted] placeholder remains', async () => {
        const { log, id } = await bobsComment();
        const c2 = log.addComment(id, U.bob, { content: 'again' });
        expect(log.deleteComment(id, c2.id, U.bob).content).toBe('[deleted]');
      });
    });
  });
});

describe('comments can be resolved and re-opened', () => {
  async function question() {
    const { log } = await setup();
    const id = proposed(log);
    return { log, id, c: log.addComment(id, U.bob, { content: 'question?' }) };
  }

  describe('GIVEN an open comment', () => {
    describe('WHEN alice resolves it', () => {
      it('THEN it is resolved', async () => {
        const { log, id, c } = await question();
        expect(log.resolveComment(id, c.id, U.alice).resolved).toBe(true);
      });
    });
  });

  describe('GIVEN a resolved comment', () => {
    describe('WHEN alice re-opens it', () => {
      it('THEN it is unresolved', async () => {
        const { log, id, c } = await question();
        log.resolveComment(id, c.id, U.alice);
        expect(log.resolveComment(id, c.id, U.alice, false).resolved).toBe(false);
      });
    });
  });
});

describe('participants accumulate roles and actions', () => {
  async function activeDecision() {
    const { log } = await setup({ mode: 'consensus_voting' });
    const id = proposed(log);
    log.addComment(id, U.bob, { content: 'question' });
    act(log, id, U.carol, 'vote', { vote: 'approve' });
    act(log, id, U.david, 'vote', { vote: 'request_revision', comment: 'docs' });
    const by = Object.fromEntries(log.getParticipants(id, U.alice).map((p: any) => [p.user, p]));
    return { log, id, by };
  }

  describe('GIVEN a decision with comments and votes', () => {
    describe('WHEN participants are listed', () => {
      it('THEN the owner has exactly the owner role', async () => {
        const { by } = await activeDecision();
        expect(by[U.alice].roles).toEqual(['owner']);
      });
    });
  });

  describe('GIVEN bob commented', () => {
    describe('WHEN participants are listed', () => {
      it('THEN bob is contributor and reviewer', async () => {
        const { by } = await activeDecision();
        expect(by[U.bob].roles).toContain('contributor');
        expect(by[U.bob].roles).toContain('reviewer');
      });
    });
  });

  describe('GIVEN carol approved and david requested a revision', () => {
    describe('WHEN participants are listed', () => {
      it('THEN carol is an approver and david a reviewer', async () => {
        const { by } = await activeDecision();
        expect(by[U.carol].roles).toContain('approver');
        expect(by[U.david].roles).toContain('reviewer');
      });
    });
  });

  describe('GIVEN bob commented', () => {
    describe('WHEN participants are listed', () => {
      it('THEN bob has a timestamped commented action', async () => {
        const { by } = await activeDecision();
        expect(by[U.bob].actions.some((a: any) => a.action_type === 'commented' && a.at)).toBe(true);
      });
    });
  });

  describe('GIVEN the lead declined a proposal', () => {
    describe('WHEN participants are listed', () => {
      it('THEN the lead is a decliner', async () => {
        // Given
        const { log } = await setup();
        const did = proposed(log);
        act(log, did, U.lead, 'decline', { reason: 'no' });
        // When
        const lead = log.getParticipants(did, U.alice).find((p: any) => p.user === U.lead);
        // Then
        expect(lead.roles).toContain('decliner');
      });
    });
  });
});

describe('meeting records store a transcript and render the documented notes format', () => {
  async function withMeeting() {
    const { log } = await setup();
    const id = proposed(log);
    const r = act(log, id, U.bob, 'add_meeting', MEETING);
    return { log, id, r, md: log.renderMeetingNotes(id, U.alice) as string };
  }

  describe('GIVEN a proposed decision', () => {
    describe('WHEN bob adds a meeting', () => {
      it('THEN 201 and the transcript text contains the spoken lines', async () => {
        const { r } = await withMeeting();
        expect(r.status_code).toBe(201);
        expect(r.data.meeting.transcript_text.includes('Rollback worries me.')).toBe(true);
      });
    });
  });

  describe('GIVEN a recorded meeting', () => {
    describe('WHEN notes are rendered', () => {
      it('THEN the heading, duration, attendees and recording appear', async () => {
        const { md } = await withMeeting();
        expect(md).toMatch(/## Meeting Records/);
        expect(md).toMatch(/### Meeting: 2024-03-21 15:00 - 00:03:10/);
        expect(md).toMatch(/\*\*Attendees\*\*: alice@acme.com, bob@acme.com/);
        expect(md).toMatch(/\*\*Recording\*\*: s3:\/\/bucket\/m1.webm/);
      });
    });
  });

  describe('GIVEN out-of-order segments', () => {
    describe('WHEN notes are rendered', () => {
      it('THEN transcript lines are time-ordered with timestamps and speakers', async () => {
        const { md } = await withMeeting();
        const lines = md.split('\n').filter((l) => l.startsWith('['));
        expect(lines).toEqual([
          '[00:00:00] **Alice**: Let us start.',
          '[00:00:45] **Bob**: Rollback worries me.',
          '[00:02:10] **Alice**: We add a dual-write period.',
        ]);
      });
    });
  });

  describe('GIVEN key takeaways', () => {
    describe('WHEN notes are rendered', () => {
      it('THEN they are listed as bullets', async () => {
        const { md } = await withMeeting();
        expect(md).toMatch(/- Add dual-write period/);
      });
    });
  });

  describe('GIVEN bob recorded a meeting', () => {
    describe('WHEN participants are listed', () => {
      it('THEN bob has a recorded_meeting action', async () => {
        const { log, id } = await withMeeting();
        expect(log.getParticipants(id, U.alice).find((p: any) => p.user === U.bob).actions.some((a: any) => a.action_type === 'recorded_meeting')).toBe(true);
      });
    });
  });
});

describe('meeting needs a transcript', () => {
  describe('GIVEN a proposed decision', () => {
    describe('WHEN bob adds a meeting without segments or transcript', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.bob, 'add_meeting', { duration_seconds: 5 }), 'VALIDATION_ERROR', 400);
      });
    });
    describe('WHEN an outsider adds a meeting', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.outsider, 'add_meeting', MEETING), 'FORBIDDEN', 403);
      });
    });
  });
});

describe('notifications: proposing notifies the team; votes notify the owner when enabled', () => {
  describe('GIVEN consensus mode', () => {
    describe('WHEN alice proposes', () => {
      it('THEN bob is notified that the decision was proposed', async () => {
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        expect(log.listNotifications(U.bob).some((n: any) => n.type === 'decision_proposed' && n.decision_id === id)).toBe(true);
      });

      it('THEN alice herself is not notified', async () => {
        const { log } = await setup({ mode: 'consensus_voting' });
        proposed(log);
        expect(log.listNotifications(U.alice).some((n: any) => n.type === 'decision_proposed')).toBe(false);
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    describe('WHEN bob votes', () => {
      it('THEN the owner gets a vote_received notification', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        // When
        act(log, id, U.bob, 'vote', { vote: 'approve' });
        // Then
        expect(log.listNotifications(U.alice).some((n: any) => n.type === 'vote_received')).toBe(true);
      });
    });
  });
});

describe('notification_on_vote=false suppresses vote notifications', () => {
  describe('GIVEN notification_on_vote=false', () => {
    describe('WHEN bob votes', () => {
      it('THEN the owner gets no vote_received notification', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting', notification_on_vote: false });
        const id = proposed(log);
        // When
        act(log, id, U.bob, 'vote', { vote: 'approve' });
        // Then
        expect(log.listNotifications(U.alice).some((n: any) => n.type === 'vote_received')).toBe(false);
      });
    });
  });
});
