# 25 · An algorithm: diffing markdown by section

## Goal

Compare two versions of a decision section by section: which lines were removed and which were added under each heading, with totals.

## You'll learn

- Turning text into structure (a heading stack)
- Maps for grouping → `learn/concepts/maps-arrays-records.md`
- Matching headings with a regex → `learn/concepts/regex.md`

## Where

- `src/decision-log/decisions/decisions.service.ts` (`diff`)
- `src/decisions/dto/diff-query.dto.ts`

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: diff groups changes by section path and accepts "v1" style refs

#### What the test wants

Diffing `v1` to `v2` returns `{ from: 1, to: 2, changes, stats }`. The `Decision` section lists the one removed and the one added line. A nested section is named by its path, `Consequences > Negative`. Unchanged sections (`Context`) are left out. `stats` totals `{ added: 2, removed: 2 }`. Diffing a version with itself gives no changes. Version 9 is `NOT_FOUND`.

#### Where to look

`diff` in `src/decision-log/decisions/decisions.service.ts`. Versions are in `revisions` (`` `${id}/v${n}` ``). Turn each version's content into a Map from heading path to its lines, then compare the two maps path by path.

#### Plan

1. `ref`: `'v1'` and `1` both mean 1 (strip a leading `v`).
2. Load both versions (404 when missing).
3. `sections(content)`: walk the lines; a heading (`##`, `###`) updates a stack of titles by its level; any other non-empty line is added under `stack.join(' > ')`.
4. For each path in either map: `removed` = lines only in the old one, `added` = lines only in the new one. Keep the path only when one of them is non-empty.
5. Sum the lengths for `stats`.

#### Almost the answer

```ts
private sections(content: string) {
  const out = new Map<string, string[]>();
  const stack: string[] = [];
  for (const line of content.split('\n')) {
    const heading = line.match(/^(#{2,6})\s+(.*)$/);
    if (heading) { stack.splice(heading[1].length - 2); stack.push(heading[2].trim()); continue; }
    if (!line.trim()) continue;
    const path = stack.join(____);
    out.set(path, [...(out.get(path) ?? []), line.trim()]);
  }
  return out;
}

const removed = before.filter((l) => !after.includes(l));
const added = after.filter((l) => ____);
if (removed.length || added.length) changes.push({ section, removed, added });
```

## Common mistakes

- Treating heading lines as content lines.
- Forgetting to cut the heading stack when a section of the same or higher level starts (`##` after `###`).
- Including unchanged sections with empty lists.
