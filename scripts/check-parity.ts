/**
 * Proves every test of the original suite (../test/*.test.js) exists in the new suite.
 * Each original test title must appear verbatim as a top-level describe() in the matching spec.
 *   bun run scripts/check-parity.ts [--table]
 */
const ORIGINAL_DIR = new URL('../../test/', import.meta.url).pathname;
const SPEC_DIR = new URL('../test/', import.meta.url).pathname;

const literal = (quote: string, body: string) => new Function(`return ${quote}${body}${quote}`)() as string;
const STR = String.raw`(['"\`])((?:\\.|(?!\1)[^\\])*)\1`;

function titles(source: string, opener: RegExp): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(new RegExp(opener.source + STR, 'gm'))) {
    if (m[2].includes('${')) continue; // helper definitions, not tests
    out.push(literal(m[1], m[2]));
  }
  return out;
}

const glob = (dir: string, re: RegExp) => [...new Bun.Glob('*').scanSync(dir)].filter((f) => re.test(f)).sort();
let missing = 0, originalTotal = 0, specIts = 0;
const rows: string[] = [];

for (const file of glob(ORIGINAL_DIR, /\.test\.js$/)) {
  const base = file.replace('.test.js', '');
  const original = titles(await Bun.file(ORIGINAL_DIR + file).text(), /^\s*(?:test|pgTest)\(\s*/);
  const specSource = await Bun.file(`${SPEC_DIR}${base}.spec.ts`).text();
  const described = new Set(titles(specSource, /^describe(?:\.skipIf\([^)\n]*\))?\(\s*/));
  specIts += [...specSource.matchAll(/^\s*it(?:\.skipIf\([^)]*\))?\(/gm)].length;
  const notPorted = original.filter((t) => !described.has(t));
  originalTotal += original.length;
  missing += notPorted.length;
  rows.push(`| ${base} | ${original.length} | ${original.length - notPorted.length} | ${notPorted.length ? notPorted.join('; ') : '-'} |`);
}

console.log('| file | original tests | ported | missing |\n|---|---|---|---|\n' + rows.join('\n'));
console.log(`\noriginal tests: ${originalTotal}   missing: ${missing}   new it() cases (incl. generated loops counted once): ${specIts}`);
process.exit(missing ? 1 : 0);
