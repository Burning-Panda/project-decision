import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, draft, proposed, act, assertCode, U } from './helpers.js';

test('anyone on the team can comment in any status; outsiders cannot', () => {
  const { log } = setup();
  const id = proposed(log);
  act(log, id, U.lead, 'approve');
  const r = act(log, id, U.bob, 'add_comment', { content: 'Has anyone tested rollback?' });
  assert.equal(r.status_code, 201);
  assert.equal(r.data.comment.user, U.bob);
  assert.equal(r.data.comment.resolved, false);
  assertCode(() => act(log, id, U.outsider, 'add_comment', { content: 'hi' }), 'FORBIDDEN', 403);
  assertCode(() => act(log, id, U.bob, 'add_comment', { content: '   ' }), 'VALIDATION_ERROR', 400);
});

test('comments are chronological, threaded and mention-aware', () => {
  const { log, clock } = setup();
  const id = proposed(log);
  const c1 = log.addComment(id, U.alice, { content: 'Proposing PostgreSQL 16' });
  clock.advanceMinutes(10);
  const c2 = log.addComment(id, U.bob, { content: 'cc @carol and @nobody', parent_id: c1.id });
  assert.equal(c2.parent_id, c1.id);
  assert.deepEqual(c2.mentions, [U.carol]);
  assert.deepEqual(log.listComments(id, U.alice).map((c) => c.id), [c1.id, c2.id]);
  assertCode(() => log.addComment(id, U.bob, { content: 'x', parent_id: 'nope' }), 'NOT_FOUND', 404);
  const n = log.listNotifications(U.carol);
  assert.ok(n.some((x) => x.type === 'mention' && x.decision_id === id));
});

test('authors may edit within five minutes only', () => {
  const { log, clock } = setup();
  const id = proposed(log);
  const c = log.addComment(id, U.bob, { content: 'first' });
  clock.advanceMinutes(4);
  const edited = log.editComment(id, c.id, U.bob, 'second');
  assert.equal(edited.content, 'second');
  assert.ok(edited.edited_at);
  assertCode(() => log.editComment(id, c.id, U.carol, 'hijack'), 'FORBIDDEN', 403);
  clock.advanceMinutes(2);
  assertCode(() => log.editComment(id, c.id, U.bob, 'too late'), 'EDIT_WINDOW_EXPIRED', 403);
});

test('delete leaves a placeholder; authors and admins only', () => {
  const { log } = setup();
  const id = proposed(log);
  const c = log.addComment(id, U.bob, { content: 'oops' });
  assertCode(() => log.deleteComment(id, c.id, U.carol), 'FORBIDDEN', 403);
  const d = log.deleteComment(id, c.id, U.org);
  assert.equal(d.content, '[deleted]');
  assert.ok(d.deleted_at);
  assert.equal(log.listComments(id, U.alice)[0].content, '[deleted]');
  const c2 = log.addComment(id, U.bob, { content: 'again' });
  assert.equal(log.deleteComment(id, c2.id, U.bob).content, '[deleted]');
});

test('comments can be resolved and re-opened', () => {
  const { log } = setup();
  const id = proposed(log);
  const c = log.addComment(id, U.bob, { content: 'question?' });
  assert.equal(log.resolveComment(id, c.id, U.alice).resolved, true);
  assert.equal(log.resolveComment(id, c.id, U.alice, false).resolved, false);
});

test('participants accumulate roles and actions', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  log.addComment(id, U.bob, { content: 'question' });
  act(log, id, U.carol, 'vote', { vote: 'approve' });
  act(log, id, U.david, 'vote', { vote: 'request_revision', comment: 'docs' });
  const by = Object.fromEntries(log.getParticipants(id, U.alice).map((p) => [p.user, p]));
  assert.deepEqual(by[U.alice].roles, ['owner']);
  assert.ok(by[U.bob].roles.includes('contributor') && by[U.bob].roles.includes('reviewer'));
  assert.ok(by[U.carol].roles.includes('approver'));
  assert.ok(by[U.david].roles.includes('reviewer'));
  assert.ok(by[U.bob].actions.some((a) => a.action_type === 'commented' && a.at));
  const declined = proposed(log, { title: 'Other' });
  const lead = setup();
  const did = proposed(lead.log);
  act(lead.log, did, U.lead, 'decline', { reason: 'no' });
  assert.ok(lead.log.getParticipants(did, U.alice).find((p) => p.user === U.lead).roles.includes('decliner'));
  assert.ok(declined);
});

const MEETING = {
  recorded_at: '2024-03-21T15:00:00Z',
  duration_seconds: 190,
  attendees: [U.alice, U.bob],
  audio_file_url: 's3://bucket/m1.webm',
  segments: [
    { start_seconds: 45, speaker: 'Bob', text: 'Rollback worries me.' },
    { start_seconds: 0, speaker: 'Alice', text: 'Let us start.' },
    { start_seconds: 130, speaker: 'Alice', text: 'We add a dual-write period.' },
  ],
  key_takeaways: ['Add dual-write period', 'Revisit in April'],
};

test('meeting records store a transcript and render the documented notes format', () => {
  const { log } = setup();
  const id = proposed(log);
  const r = act(log, id, U.bob, 'add_meeting', MEETING);
  assert.equal(r.status_code, 201);
  assert.equal(r.data.meeting.transcript_text.includes('Rollback worries me.'), true);
  const md = log.renderMeetingNotes(id, U.alice);
  assert.match(md, /## Meeting Records/);
  assert.match(md, /### Meeting: 2024-03-21 15:00 - 00:03:10/);
  assert.match(md, /\*\*Attendees\*\*: alice@acme.com, bob@acme.com/);
  assert.match(md, /\*\*Recording\*\*: s3:\/\/bucket\/m1.webm/);
  const lines = md.split('\n').filter((l) => l.startsWith('['));
  assert.deepEqual(lines, [
    '[00:00:00] **Alice**: Let us start.',
    '[00:00:45] **Bob**: Rollback worries me.',
    '[00:02:10] **Alice**: We add a dual-write period.',
  ]);
  assert.match(md, /- Add dual-write period/);
  assert.ok(log.getParticipants(id, U.alice).find((p) => p.user === U.bob).actions.some((a) => a.action_type === 'recorded_meeting'));
});

test('meeting needs a transcript', () => {
  const { log } = setup();
  const id = proposed(log);
  assertCode(() => act(log, id, U.bob, 'add_meeting', { duration_seconds: 5 }), 'VALIDATION_ERROR', 400);
  assertCode(() => act(log, id, U.outsider, 'add_meeting', MEETING), 'FORBIDDEN', 403);
});

test('notifications: proposing notifies the team; votes notify the owner when enabled', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  assert.ok(log.listNotifications(U.bob).some((n) => n.type === 'decision_proposed' && n.decision_id === id));
  assert.equal(log.listNotifications(U.alice).some((n) => n.type === 'decision_proposed'), false);
  act(log, id, U.bob, 'vote', { vote: 'approve' });
  assert.ok(log.listNotifications(U.alice).some((n) => n.type === 'vote_received'));
});

test('notification_on_vote=false suppresses vote notifications', () => {
  const { log } = setup({ mode: 'consensus_voting', notification_on_vote: false });
  const id = proposed(log);
  act(log, id, U.bob, 'vote', { vote: 'approve' });
  assert.equal(log.listNotifications(U.alice).some((n) => n.type === 'vote_received'), false);
  assert.ok(draft(log));
});
