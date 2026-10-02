import { words } from './util.js';

export const RELATIONSHIP_TYPES = ['supersedes', 'related', 'complements', 'conflicts', 'context'];

const STOP = new Set('the and for with that this from are was were will have has had not but can all any our their its into over use using been being than then them they you your out per via'.split(' '));

function vector(text) {
  const v = new Map();
  for (const w of words(text)) if (w.length > 2 && !STOP.has(w)) v.set(w, (v.get(w) ?? 0) + 1);
  return v;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of a) { na += x * x; dot += x * (b.get(k) ?? 0); }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Default relatedness finder: bag-of-words cosine similarity.
 * Contract (swap in an embedding-backed implementation with the same shape):
 *   (decision, candidates) => [{ decision_id, type, score }]   // score is 0-100
 */
export function lexicalFinder(decision, candidates) {
  const target = vector(`${decision.title} ${decision.title} ${decision.content}`);
  return candidates.map((c) => ({
    decision_id: c.id,
    type: 'related',
    score: Math.round(cosine(target, vector(`${c.title} ${c.title} ${c.content}`)) * 100),
  }));
}
