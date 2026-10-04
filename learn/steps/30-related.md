# 30 · Related decisions and superseding

## Goal

Related decisions: after every create, draft save and propose, a finder suggests related decisions (a text-similarity default you can replace), ids mentioned in the document are linked, people confirm or dismiss suggestions, links show from both sides, and superseding links a successor to the decision it replaces.

## You'll learn

- Text similarity: cosine similarity over word counts, and why stop words matter → `learn/concepts/glossary.md`
- Injectable strategies: `options.relatedFinder` replaces the default
- Not resurrecting what a person dismissed
- Letting `DecisionsService` announce "a decision was saved" without depending on the service that listens

## Where

- `src/decision-log/related/related.service.ts`
- `src/decision-log/decisions/decisions.service.ts` (`create`, `updateDraft`, `perform`: propose, approve, `create_superseding_decision`; `renderDocument`)
- New collection `relationships` (ARRAY) and a migration
- Options on the log: `relatedFinder` and `relatedThreshold` (read them from `this.ctx.options`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: default finder links near-duplicate decisions and ignores unrelated ones

#### What the test wants

Two near-duplicate decisions about a PostgreSQL migration and an unrelated coffee decision. The newer duplicate has exactly one link, to the older one: `ai_identified: true`, `type: related`, `confidence_score` between 60 and 100. The coffee decision has no links.

#### Where to look

`src/decision-log/related/related.service.ts` is built like the earlier services, but it must be told when a decision was saved. `RelatedService` already depends on `DecisionsService`, so (as in step 26) `DecisionsService` cannot call it. Add a listener list to `DecisionsService`: `onSave(listener)` stores it, `saved(d, actor)` calls them all. `RelatedService` registers in its constructor. `create`, `updateDraft` and `propose` call `saved` at the end.

#### Plan

1. `DecisionsService`: `onSave` and a private `saved(d, actor)`; call `saved` at the end of `create`, `updateDraft` and the `propose` branch.
2. `RelatedService.scan(d, actor)`: the finder is `this.ctx.options.relatedFinder ?? textFinder`; call it with the decision and every *other* decision; keep hits whose `score >= threshold` (`this.ctx.options.relatedThreshold ?? 60`).
3. Store each as `{ decision_id: d.id, related_decision_id, type, confidence_score: score, ai_identified: true, status: 'suggested', created_by, created_at }` in `relationships`.
4. The default `textFinder`: lowercase `title + content`, split into words with `/[a-z0-9]+/g`, drop stop words, count each word. Score = `round(dot / (|a| × |b|) × 100)`, where `dot` is the sum over shared words of `count_a × count_b` and `|x|` is the square root of the sum of squared counts. Without the stop words, unrelated texts share `the`, `and`, `for`... and score 15-20; with them, the coffee text scores 0.

#### Almost the answer

```ts
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'is', 'are', 'we', 'be', 'by', 'as', 'at', 'it', 'this', 'that', 'from']);

const counts = (text: string) => {
  const c = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) if (!STOP.has(w)) c.set(w, (c.get(w) ?? 0) + 1);
  return c;
};

const similarity = (a: string, b: string) => {
  const x = counts(a), y = counts(b);
  let dot = 0;
  for (const [w, n] of x) dot += n * (y.get(w) ?? 0);
  const len = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  return len(x) && len(y) ? Math.round((dot / (len(x) * ____)) * 100) : 0;
};

const textFinder = (d, candidates) =>
  candidates.map((c) => ({ decision_id: c.id, type: 'related', score: similarity(`${d.title} ${d.content}`, `${c.title} ${c.content}`) }));
```

### Section: injected finder results are filtered by the confidence threshold

#### What the test wants

A replacement finder returns a 92 `conflicts` hit and a 40 `complements` hit; with threshold 60, only the 92 is linked, with its own type.

#### Where to look

The same `scan`. The finder is whatever `options.relatedFinder` is, and its hits carry their own `type`. The test finder ignores its arguments and names decisions by id, so unknown ids must be skipped, not crash.

#### Plan

1. For each hit: skip when the decision does not exist, is the decision itself, or `hit.score < threshold`.
2. Use the hit's `type` and `score` as they are.

#### Almost the answer

```ts
for (const hit of finder(d, others) ?? []) {
  const other = this.ctx.store.decisions.get(hit.decision_id);
  if (!other || other.id === d.id || hit.score ____ threshold) continue;
  /* link it, unless it exists (next sections) */
}
```

### Section: finder runs on create, draft save and propose

#### What the test wants

A finder that counts its calls was called once after create, twice after a draft save, three times after propose.

#### Where to look

The three `saved(...)` calls from the first section. One call per event, not one per candidate: call the finder once with all candidates, and call it even when there are none.

#### Plan

1. `create`: call `this.saved(decision, actor)` after the decision is stored.
2. `updateDraft`: after the change.
3. `perform`, `propose`: once, after the status changed.

#### Almost the answer

```ts
// end of create and updateDraft
this.saved(d, actor);

// perform, after the switch
if (request.action === 'propose') this.saved(d, actor);
```

### Section: rescans do not duplicate suggestions or resurrect dismissed ones

#### What the test wants

Saving the draft again leaves one suggestion, not two. A dismissed suggestion stays hidden after another scan (propose): `getRelated` shows none, and `getRelated(id, actor, { includeDismissed: true })` shows it once.

#### Where to look

`scan`, and `get`. A link is identified by the pair (decision, related decision). Look it up before creating.

#### Plan

1. `find(id, relatedId)`: the existing link for the pair.
2. Not found: create it (a `suggested` AI link). Put the creation in a private `link(d, other, type, score, ai, by)` helper; the notification section extends it.
3. Found and still a `suggested` AI link: refresh its `type` and score.
4. Found and `dismissed` or `confirmed` or manual: leave it alone.
5. `get` hides `dismissed` links unless `opts.includeDismissed`.

#### Almost the answer

```ts
const existing = this.find(d.id, other.id);
if (!existing) this.link(d, other, hit.type, hit.score, true, actor);
else if (existing.ai_identified && existing.status === 'suggested') Object.assign(existing, { type: hit.type, confidence_score: hit.score });

// get
const visible = (r) => opts.includeDismissed || r.status !== ____;
```

### Section: suggestions can be confirmed; manual links record their type

#### What the test wants

Bob confirms a suggestion: its `status` is `confirmed`. Bob links a third decision to PRJ-001 as `complements`: `ai_identified: false`, `confidence_score: 100`, `created_by` bob. An unknown link type is `VALIDATION_ERROR`, a missing decision `NOT_FOUND`, an outsider `FORBIDDEN`.

#### Where to look

`review` and `add` in `RelatedService`. `add` checks in this order: access (outsider), type, then that the other decision exists.

#### Plan

1. `add(id, actor, link)`: `this.decisions.get(id, actor)` (403); type in `related | conflicts | complements | supersedes` (400); the related decision exists (404).
2. Store it as a manual link: `ai_identified: false`, `confidence_score: 100`, `status: 'confirmed'`, `created_by: actor`.
3. `review(id, relatedId, actor, verdict)`: `confirm` sets `confirmed`, `dismiss` sets `dismissed`; another verdict is a 400, a missing link a 404. Return a copy.

#### Almost the answer

```ts
const TYPES = ['related', 'conflicts', 'complements', 'supersedes'];
add(id, actor, link) {
  const d = this.decisions.get(id, actor);
  if (!TYPES.includes(link.type)) throw new DecisionLogError('VALIDATION_ERROR', `unknown link type ${link.type}`, 400);
  const other = this.ctx.store.decisions.get(link.related_decision_id);
  if (!other) throw new DecisionLogError(____, `decision ${link.related_decision_id} not found`, 404);
  this.ctx.store.relationships.push({ decision_id: id, related_decision_id: other.id, type: link.type, confidence_score: 100,
    ai_identified: false, status: 'confirmed', created_by: actor, created_at: this.ctx.now() });
  /* return a copy of it */
}
```

### Section: rendered document lists related decisions with type and match percent

#### What the test wants

A 92% `conflicts` suggestion to "Database platform selection": the rendered document contains `## Related Decisions` and the line `**PRJ-001: Database platform selection** - *Conflicts* (92% match)`.

#### Where to look

`renderDocument` in `src/decision-log/decisions/decisions.service.ts` (step 18). Add a section at the end when the decision has visible outgoing links. Read `this.ctx.store.relationships` directly; `DecisionsService` cannot call `RelatedService`.

#### Plan

1. The decision's own links (`decision_id === d.id`), not dismissed.
2. None: add nothing.
3. Otherwise a blank line, `## Related Decisions`, a blank line, then one `- **ID: Title** - *Type* (N% match)` line each, with the type capitalised.

#### Almost the answer

```ts
const links = this.ctx.store.relationships.filter((r) => r.decision_id === d.id && r.status !== 'dismissed');
if (links.length) {
  const lines = links.map((r) => {
    const other = this.ctx.store.decisions.get(r.related_decision_id);
    const type = r.type[0].toUpperCase() + r.type.slice(1);
    return `- **${other.id}: ${other.title}** - *${type}* (${r.confidence_score}% match)`;
  });
  /* append ['', '## Related Decisions', '', ...lines] to the document lines */
}
```

### Section: links are visible from both sides, with direction

#### What the test wants

A `conflicts` link from the newer decision: read from the newer side it is `outgoing`; read from PRJ-001 it is `incoming`, with `related_decision_id` the newer decision, `related_title` its title, `type: conflicts`. When the newer side dismisses it, the incoming side no longer shows it.

#### Where to look

`get` in `RelatedService`. One stored row serves both sides; build the view when reading.

#### Plan

1. Outgoing: rows where `decision_id === id`, plus `direction: 'outgoing'` and `related_title` (the other decision's title).
2. Incoming: rows where `related_decision_id === id`; swap the ids so `related_decision_id` is the *other* decision, `direction: 'incoming'`, `related_title` the other's title.
3. Both sides skip `dismissed` rows (unless `includeDismissed`).

#### Almost the answer

```ts
const title = (id: string) => this.ctx.store.decisions.get(id)?.title;
const outgoing = rows.filter((r) => r.decision_id === id && visible(r))
  .map((r) => ({ ...structuredClone(r), direction: 'outgoing', related_title: title(r.related_decision_id) }));
const incoming = rows.filter((r) => r.related_decision_id === id && visible(r))
  .map((r) => ({ ...structuredClone(r), decision_id: id, related_decision_id: r.decision_id, direction: '____', related_title: title(r.decision_id) }));
return [...outgoing, ...incoming];
```

### Section: decision ids mentioned in the document are linked automatically

#### What the test wants

A document saying "builds on PRJ-001 and ignores PRJ-777 and itself (PRJ-002)" links only PRJ-001: type `related`, 100, not AI. Saving again with PRJ-001 twice does not duplicate it.

#### Where to look

The end of `scan`. Decision ids look like `PRJ-001`: letters, a dash, digits. Only ids that exist count, and never the decision itself.

#### Plan

1. Find ids with a regex; keep each once (`new Set`).
2. For each existing, other decision without a link yet: create a non-AI `related` link with confidence 100 (`status: 'confirmed'`).

#### Almost the answer

```ts
for (const id of new Set(d.content.match(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/g) ?? [])) {
  const other = this.ctx.store.decisions.get(id);
  if (other && other.id !== d.id && !this.find(d.id, other.id)) this.link(d, other, 'related', 100, false, actor);
}
```

### Section: incoming notification: owners are told when a new decision relates to theirs

#### What the test wants

Bob owns PRJ-001; carol creates PRJ-002, which the finder relates to it. Bob has a `related_decision` notification for PRJ-001; carol has none.

#### Where to look

The `link` helper that creates every new link. It tells the owner of the *other* (older) decision, using `notify` (step 26), with the new decision's owner as the actor.

#### Plan

1. When a link is created (finder, mention or manual): `notify(other.owner, 'related_decision', other, d.owner)`.
2. Not on rescans that only refresh a link. `notify` stays silent when both owners are the same person.

#### Almost the answer

```ts
private link(d, other, type, score, ai, by) {
  this.ctx.store.relationships.push({ /* the link */ });
  this.profiles.notify(other.____, 'related_decision', other, d.owner);
}
```

### Section: superseding creates a linked draft; original is marked once the new one is approved

#### What the test wants

On an approved decision, bob uses `create_superseding_decision` (title, content): 201 and a new draft owned by bob with `supersedes_id` set; the original is still `is_superseded: false`. On a proposed (not approved) decision it is `INVALID_STATE`. After the successor is proposed and approved, the original has `is_superseded: true`, `superseded_by_id: PRJ-002` and is still `approved`; PRJ-002 has a `supersedes` link to it.

#### Where to look

`src/decision-log/decisions/decisions.service.ts`: `perform` (new branch), `create` (`is_superseded: false` on every new decision), and the approve step shared by single approval and the closing vote (name it `approveNow` if you have not). The state table already puts `create_superseding_decision` only in `approved`.

#### Plan

1. Who may: a team member (or the owner or org admin).
2. The branch calls `this.create({ project, title, content, actor })`, then sets `supersedes_id` on the stored new decision. Answer 201 with the new decision.
3. When any decision becomes approved and has `supersedes_id`: mark the original (`is_superseded: true`, `superseded_by_id`) and push a `supersedes` link (`decision_id` the new one, `related_decision_id` the old, 100, confirmed).

#### Almost the answer

```ts
case 'create_superseding_decision': {
  const next = this.create({ project: d.project, title: payload.title, content: payload.content, actor });
  this.ctx.store.decisions.get(next.id).supersedes_id = d.id;
  return this.envelope({ ...next, supersedes_id: d.id }, request.action, previous, now, ____);
}

// where a decision becomes approved
const old = d.supersedes_id && this.ctx.store.decisions.get(d.supersedes_id);
if (old) {
  Object.assign(old, { is_superseded: true, superseded_by_id: d.id });
  this.ctx.store.relationships.push({ decision_id: d.id, related_decision_id: old.id, type: 'supersedes', confidence_score: 100,
    ai_identified: false, status: 'confirmed', created_by: d.owner, created_at: now });
}
```

## Common mistakes

- Calling `RelatedService` from `DecisionsService` (circular dependency). Use a listener list (`onSave`).
- Running the finder once per candidate instead of once per save: the counting test sees the wrong number.
- Comparing with `>` instead of `>=` against the threshold; a score exactly on the threshold counts.
- Resurrecting dismissed links on every rescan: look the pair up first.
- Forgetting `is_superseded: false` on new decisions: the test wants `false`, not `undefined`.
- Keeping stop words in the similarity: unrelated texts then look 15-20% alike.
