/** Line diff grouped by markdown section ("Consequences > Negative"). */
function annotate(lines) {
  const stack = [];
  return lines.map((text) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(text);
    if (m) {
      while (stack.length && stack.at(-1).level >= m[1].length) stack.pop();
      stack.push({ level: m[1].length, text: m[2].trim() });
    }
    return { text, section: stack.map((s) => s.text).join(' > ') || '(preamble)' };
  });
}

export function diffMarkdown(oldText, newText) {
  const a = annotate(oldText.split('\n').map((l) => l.trimEnd()));
  const b = annotate(newText.split('\n').map((l) => l.trimEnd()));
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i].text === b[j].text ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const groups = new Map();
  const push = (section, kind, text) => {
    if (!text.trim()) return;
    if (!groups.has(section)) groups.set(section, { section, removed: [], added: [] });
    groups.get(section)[kind].push(text);
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) { i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push(a[i].section, 'removed', a[i].text); i++; }
    else { push(b[j].section, 'added', b[j].text); j++; }
  }
  while (i < n) { push(a[i].section, 'removed', a[i].text); i++; }
  while (j < m) { push(b[j].section, 'added', b[j].text); j++; }
  const changes = [...groups.values()];
  return {
    changes,
    stats: {
      added: changes.reduce((s, c) => s + c.added.length, 0),
      removed: changes.reduce((s, c) => s + c.removed.length, 0),
    },
  };
}
