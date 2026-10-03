/**
 * The learning-path runner.
 *
 *   bun run learn              where am I? runs every spec once, finds the first unfinished step, shows its first failing test
 *   bun run learn status       progress per level
 *   bun run learn hint         reveal the next hint for the current step
 *   bun run learn step <n|id>  run one step and show all of its failures
 *   bun run learn list         every step, in order
 *   bun run learn check        every top-level spec section belongs to exactly one step, and every brief exists
 *
 * Progress comes from the tests; `.learn/progress.json` only remembers the furthest step reached and revealed hints.
 */
import { LEVELS, STEPS, type Step, type StepSpec } from '../learn/steps';

const ROOT = new URL('..', import.meta.url).pathname;
const STATE_DIR = `${ROOT}.learn`;
const STATE_FILE = `${STATE_DIR}/progress.json`;
const RESULTS_FILE = `${STATE_DIR}/results.xml`;

const tty = process.stdout.isTTY;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1'), dim = paint('2'), green = paint('32'), red = paint('31'), yellow = paint('33'), cyan = paint('36');

// ---------------------------------------------------------------- state
interface State { furthest: number; hints: Record<string, number> }

async function readState(): Promise<State> {
  try { return { furthest: -1, hints: {}, ...(await Bun.file(STATE_FILE).json()) }; } catch { return { furthest: -1, hints: {} }; }
}
async function writeState(state: State) {
  Bun.spawnSync(['mkdir', '-p', STATE_DIR]);
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------- spec sections (static)
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

/** Top-level describe titles of a spec file, in order. */
async function sectionsOf(file: string): Promise<string[]> {
  const source = await Bun.file(ROOT + file).text();
  return [...source.matchAll(/^describe(?:\.skipIf\([^)\n]*\))?\('((?:\\.|[^'\\])*)'/gm)].map((m) => unescape(m[1]!));
}

const specFiles = () => [...new Bun.Glob('test/**/*.spec.ts').scanSync(ROOT)].sort();

// ---------------------------------------------------------------- results (one junit run)
interface Tally { pass: number; fail: number; skip: number; firstFailure?: string }
type Results = Map<string, Tally>;
const key = (file: string, section: string) => `${file}::${section}`;

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const attr = (attrs: string, name: string) => decode(attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '');

function parseJunit(xml: string): Results {
  const results: Results = new Map();
  const stack: Array<{ name: string; file: string }> = [];
  const tag = /<(\/?)(testsuite|testcase)\b([^>]*?)(\/?)>|<(failure|error|skipped)\b/g;
  let open: { file: string; section: string; path: string; outcome: 'pass' | 'fail' | 'skip' } | null = null;
  const close = () => {
    if (!open) return;
    const t = results.get(key(open.file, open.section)) ?? { pass: 0, fail: 0, skip: 0 };
    t[open.outcome]++;
    if (open.outcome === 'fail' && !t.firstFailure) t.firstFailure = open.path;
    results.set(key(open.file, open.section), t);
    open = null;
  };
  for (const m of xml.matchAll(tag)) {
    const [, closing, name, attrs = '', selfClosing, inner] = m;
    if (inner) { if (open) open.outcome = inner === 'skipped' ? 'skip' : 'fail'; continue; }
    if (name === 'testsuite') {
      if (closing) stack.pop(); else stack.push({ name: attr(attrs, 'name'), file: attr(attrs, 'file') });
      continue;
    }
    if (closing) { close(); continue; }
    const [fileSuite, section, ...rest] = stack;
    if (!fileSuite || !section) continue;
    open = { file: fileSuite.file, section: section.name, path: [section.name, ...rest.map((s) => s.name), attr(attrs, 'name')].join(' > '), outcome: 'pass' };
    if (selfClosing) close();
  }
  return results;
}

async function runAll(): Promise<Results> {
  Bun.spawnSync(['mkdir', '-p', STATE_DIR]);
  const files = [...new Set(STEPS.flatMap((s) => s.specs.map((x) => x.file)))].map((f) => `./${f}`);
  Bun.spawnSync(['bun', 'test', ...files, '--reporter=junit', `--reporter-outfile=${RESULTS_FILE}`], { cwd: ROOT, stdout: 'ignore', stderr: 'ignore' });
  return parseJunit(await Bun.file(RESULTS_FILE).text());
}

// ---------------------------------------------------------------- steps
type Status = 'done' | 'todo' | 'skipped' | 'empty';
interface StepResult extends Tally { status: Status; sections: SectionResult[] }
interface SectionResult extends Tally { file: string; section: string }

async function sectionsFor(spec: StepSpec) { return spec.sections ?? (await sectionsOf(spec.file)); }

async function evaluate(step: Step, results: Results): Promise<StepResult> {
  const total: StepResult = { pass: 0, fail: 0, skip: 0, status: 'todo', sections: [] };
  for (const spec of step.specs) {
    for (const section of await sectionsFor(spec)) {
      const t = results.get(key(spec.file, section)) ?? { pass: 0, fail: 0, skip: 0 };
      total.sections.push({ file: spec.file, section, ...t });
      total.pass += t.pass; total.fail += t.fail; total.skip += t.skip;
      total.firstFailure ??= t.firstFailure;
    }
  }
  const count = total.pass + total.fail + total.skip;
  if (step.optional && !process.env.TEST_DATABASE_URL) total.status = 'skipped';
  else if (count === 0) total.status = 'empty';
  else if (total.fail === 0 && total.skip === 0) total.status = 'done';
  return total;
}

/** The section to work on: the first one, in the step's order, that has a failing (or no) test. */
const currentSection = (r: StepResult) => r.sections.find((s) => s.fail > 0 || s.pass + s.fail + s.skip === 0);

async function evaluateAll() {
  const results = await runAll();
  const evaluated: StepResult[] = [];
  for (const step of STEPS) evaluated.push(await evaluate(step, results));
  const current = evaluated.findIndex((r) => r.status === 'todo' || r.status === 'empty');
  return { evaluated, current };
}

const findStep = (ref: string) => {
  const n = Number(ref);
  return STEPS.findIndex((s, i) => (Number.isInteger(n) ? i === n : s.id === ref || s.id.endsWith(ref)));
};

// ---------------------------------------------------------------- briefs
const briefPath = (step: Step) => `learn/steps/${step.id}.md`;

interface Rung { title: string; body: string }
interface Brief { goal: string; mistakes: string; general: string[]; sections: Map<string, Rung[]> }

/**
 * A brief's `## Hints` holds either `### Section: <exact section title>` blocks, each with `#### <rung title>` rungs
 * (what the test wants, where, plan, skeleton), or plain `### Hint N` blocks for the whole step.
 */
async function brief(step: Step): Promise<Brief> {
  const text = await Bun.file(ROOT + briefPath(step)).text().catch(() => '');
  const part = (title: string) => text.split(new RegExp(`^## ${title}\\s*$`, 'm'))[1]?.split(/^## /m)[0]?.trim() ?? '';
  const general: string[] = [];
  const sections = new Map<string, Rung[]>();
  for (const block of part('Hints').split(/^### /m).slice(1)) {
    const [heading = '', ...rest] = block.split('\n');
    const body = rest.join('\n');
    const title = heading.match(/^Section:\s*(.+?)\s*$/)?.[1];
    if (!title) { general.push(body.trim()); continue; }
    const rungs = body.split(/^#### /m).slice(1).map((r) => {
      const [t = '', ...b] = r.split('\n');
      return { title: t.trim(), body: b.join('\n').trim() };
    });
    sections.set(title, rungs);
  }
  return { goal: part('Goal'), mistakes: part('Common mistakes'), general, sections };
}

// ---------------------------------------------------------------- diagnosis
let stubIndex: Map<string, string> | undefined;

/** Where each `throw new NotImplementedError('X')` lives, so a failure can point at the exact line. */
async function stubLocation(name: string): Promise<string | undefined> {
  if (!stubIndex) {
    stubIndex = new Map();
    for (const file of new Bun.Glob('src/**/*.ts').scanSync(ROOT)) {
      const lines = (await Bun.file(ROOT + file).text()).split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/NotImplementedError\(['`]([^'`]+)['`]\)/);
        if (m && !stubIndex!.has(m[1]!)) stubIndex!.set(m[1]!, `${file}:${i + 1}`);
      });
    }
  }
  return stubIndex.get(name);
}

const STATUS_MEANING: Record<string, string> = {
  '400': 'the request was rejected as invalid (a validation error).',
  '401': 'the caller was not identified (no usable X-User header).',
  '403': 'the caller was identified but not allowed.',
  '404': 'nothing matched: an unknown route, or an id that does not exist.',
  '409': 'a conflict with the current state (a duplicate, or the wrong state for this action).',
  '500': 'the server threw an error. Look for the error printed above; often a stub or a bug behind the endpoint.',
};

/** Plain-language explanations of the failure in `output` (bun's test output), most specific first. */
async function diagnose(output: string): Promise<string[]> {
  const text = output.replace(/\x1b\[[0-9;]*m/g, '');
  const out: string[] = [];
  let m: RegExpMatchArray | null;

  if (/setup\(\): building the owner\/team\/project fixture failed/.test(text)) {
    out.push('The shared test fixture (owner acme, its default team, project PRJ) could not be built, so an earlier step is broken. Fix the steps it names first (owners, teams, projects).');
  }
  if ((m = text.match(/NotImplementedError: (?:TODO: )?([^\n]+)/))) {
    const name = m[1]!.trim();
    const where = await stubLocation(name);
    out.push(`\`${name}\` still throws its placeholder${where ? ` (${where})` : ''}. Replace the \`throw new NotImplementedError(...)\` line with your implementation.`);
  }
  if ((m = text.match(/expected error (\w+) but nothing was thrown/))) {
    out.push(`The test expected your code to refuse this with code ${m[1]}, but nothing was thrown. Add a check that throws \`new DecisionLogError('${m[1]}', 'what went wrong', status)\`.`);
  } else if ((m = text.match(/expected (\w+), got (\w+): ([^\n]*)/)) && m[2] !== 'ERR_NOT_IMPLEMENTED') {
    out.push(`Your code threw ${m[2]} ("${m[3]!.trim()}") but the test wants ${m[1]}. Usually the checks run in the wrong order, or the wrong code is used.`);
  }
  if ((m = text.match(/Expected: (\d{3})\s*\n\s*Received: (\d{3})/))) {
    out.push(`The HTTP status was ${m[2]} instead of ${m[1]}. ${m[2]} means ${STATUS_MEANING[m[2]!] ?? 'see the error above.'}`);
  }
  if (/Received function did not throw/.test(text)) {
    out.push('The test expected this call to throw an error, but it returned normally. Add the check (validation, permission, state) that should reject it.');
  }
  if ((m = text.match(/undefined is not an object \(evaluating '([^']+)'\)|Cannot read propert(?:y|ies) of undefined \(reading '([^']+)'\)/))) {
    const expr = m[1] ?? m[2]!;
    out.push(/store/.test(expr)
      ? `\`${expr}\`: something on the store is undefined. If it is a collection, add its name to the lists in src/storage/store.ts (and a migration).`
      : `\`${expr}\`: the part before the last dot is undefined. Did a function return nothing, or is a property spelled differently?`);
  }
  if ((m = text.match(/(\S+) is not a function/))) {
    out.push(`\`${m[1]}\` is not a function: the method does not exist (yet) or is spelled differently from what the test calls.`);
  }
  if (/Expected:[^\n]*\n\s*Received: undefined/.test(text)) {
    out.push('Your code returned nothing (`undefined`). Did you forget a `return`, or read a property that does not exist?');
  }
  if (/Expected: (true|false)\s*\n\s*Received: (true|false)/.test(text)) {
    out.push('A yes/no check came out the other way. Read the THEN title: it says which condition must hold.');
  }
  if (/- Expected\s*\n\s*\+ Received/.test(text)) {
    out.push('Read the diff: lines starting with `-` are what the test expected, `+` what your code produced. Only those lines differ.');
  }
  if (/Expected (?:pattern|substring)/.test(text)) {
    out.push('Your text does not match the expected pattern. Compare the pattern with the received text character by character (spaces, colons, capitals).');
  }
  if (/Unhandled error between tests/.test(text)) {
    out.push('The error happened while preparing the test (a beforeEach: the GIVEN or WHEN), not in the THEN. The stack trace shows where.');
  }
  if (/timed out after/i.test(text)) {
    out.push('The test waited too long: a promise was never resolved or awaited, or a loop never ends.');
  }
  if ((m = text.match(/Cannot find module '([^']+)'/))) out.push(`An import cannot be found: \`${m[1]}\`. Check the relative path and the file name.`);
  if (/SyntaxError|Expected "[^"]+" but found/.test(text)) {
    out.push('A file could not be read at all: a syntax error. Look at the file and line in the message (often a missing bracket, comma or quote).');
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------- output
function header(index: number, result?: StepResult) {
  const step = STEPS[index]!;
  console.log(`${dim(`Level ${step.level} · ${LEVELS[step.level]}`)}`);
  console.log(bold(`Step ${index} of ${STEPS.length - 1} — ${step.title}`));
  if (step.edit.length) console.log(`${dim('Edit: ')} ${step.edit.join(', ')}`);
  console.log(`${dim('Brief:')} ${briefPath(step)}`);
  if (result) console.log(`${dim('Tests:')} ${result.pass} of ${result.pass + result.fail + result.skip} pass`);
}

function sectionList(result: StepResult, now?: SectionResult) {
  if (result.sections.length < 2) return;
  console.log(dim('\nSections in this step:'));
  for (const s of result.sections) {
    const total = s.pass + s.fail + s.skip;
    const done = total > 0 && s.fail === 0 && s.skip === 0;
    const mark = done ? green('✓') : s === now ? yellow('▶') : dim('○');
    console.log(`  ${mark} ${s.section} ${dim(done ? `${total}` : `${s.pass}/${total}`)}${s === now ? yellow('  ← you are here') : ''}`);
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs one spec file, optionally limited to some sections, printing bun's output; returns that output. */
function runSpec(file: string, sections: string[] | undefined, bail: boolean): string {
  const args = ['bun', 'test', `./${file}`, '--only-failures'];
  if (sections) args.push('-t', `^(?:${sections.map(escapeRegex).join('|')}) `);
  if (bail) args.push('--bail');
  const run = Bun.spawnSync(args, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, FORCE_COLOR: tty ? '1' : '0' } });
  const output = run.stdout.toString() + run.stderr.toString();
  process.stdout.write(output);
  return output;
}

async function explain(output: string) {
  const notes = await diagnose(output);
  if (!notes.length) return;
  console.log(cyan(bold('\nWhat this usually means:')));
  for (const n of notes) console.log(cyan(`  • ${n}`));
}

// ---------------------------------------------------------------- commands
async function where() {
  const state = await readState();
  const { evaluated, current } = await evaluateAll();
  if (current === -1) {
    console.log(green(bold('Every step is done. You built the whole application, test first.')));
    return;
  }
  const result = evaluated[current]!;
  const step = STEPS[current]!;
  if (result.status === 'empty') {
    console.log(red(`Step ${step.id} matches no tests. Run \`bun run learn check\`.`));
    process.exitCode = 1;
    return;
  }
  if (state.furthest > current) {
    console.log(yellow(`You had reached step ${state.furthest}; a later change broke step ${current}. Fix it before moving on.\n`));
  } else if (current > state.furthest) {
    if (current > 0 && state.furthest < 0) console.log(cyan('New here? Read learn/README.md, then the level 0 briefs (worked examples, already passing).\n'));
    if (state.furthest >= 0) console.log(green(`Step ${state.furthest} is done. On to the next one.\n`));
    await writeState({ ...state, furthest: current });
  }

  const now = currentSection(result);
  const b = await brief(step);
  header(current, result);
  if (b.goal) console.log(`\n${b.goal}`);
  sectionList(result, now);

  const rungs = now ? b.sections.get(now.section) : undefined;
  if (now) console.log(bold(`\nNow: ${now.section}`));
  if (rungs?.[0]) console.log(`${rungs[0].body}\n`);

  console.log(dim('First failing test:'));
  const output = now ? runSpec(now.file, [now.section], true) : '';
  await explain(output);
  console.log(dim(`\nMake it pass, then run \`bun run learn\` again. Stuck? \`bun run learn hint\` gives the next hint for this section.`));
  process.exitCode = 1;
}

async function status() {
  const { evaluated, current } = await evaluateAll();
  STEPS.forEach((step, i) => {
    if (i === 0 || STEPS[i - 1]!.level !== step.level) console.log(bold(`\nLevel ${step.level} · ${LEVELS[step.level]}`));
    const r = evaluated[i]!;
    const total = r.pass + r.fail + r.skip;
    const mark = r.status === 'done' ? green('✓') : r.status === 'skipped' ? dim('–') : i === current ? yellow('▶') : dim('○');
    const counts = r.status === 'done' ? dim(`${total}`) : r.status === 'skipped' ? dim('optional, skipped') : `${r.pass}/${total}`;
    console.log(`  ${mark} ${String(i).padStart(2)} ${step.title} ${counts}`);
  });
  const done = evaluated.filter((r) => r.status === 'done' || r.status === 'skipped').length;
  console.log(`\n${done} of ${STEPS.length} steps done.`);
}

async function hint() {
  const state = await readState();
  const { evaluated, current } = await evaluateAll();
  if (current === -1) return console.log('Nothing left to hint at: every step is done.');
  const step = STEPS[current]!;
  const b = await brief(step);
  const now = currentSection(evaluated[current]!);
  const rungs = now ? b.sections.get(now.section) : undefined;

  const ladder = rungs?.map((r) => `${bold(r.title)}\n${r.body}`) ?? b.general;
  if (!ladder.length) return console.log(`No hints written for ${step.id} yet. Re-read the brief: ${briefPath(step)}`);
  const stateKey = rungs && now ? `${step.id}::${now.section}` : step.id;
  const shown = Math.min((state.hints[stateKey] ?? 0) + 1, ladder.length);

  if (rungs && now) console.log(dim(`Hints for: ${now.section}\n`));
  for (let i = 0; i < shown; i++) console.log(`${dim(`Hint ${i + 1} of ${ladder.length}`)}\n${ladder[i]}\n`);
  if (shown === ladder.length) {
    console.log(dim('That was the last hint for this section.'));
    if (b.mistakes) console.log(`\n${bold('Common mistakes')}\n${b.mistakes}`);
  } else {
    console.log(dim('Run `bun run learn hint` again for a more specific one.'));
  }
  await writeState({ ...state, hints: { ...state.hints, [stateKey]: shown } });
}

async function step(ref: string | undefined) {
  const index = ref === undefined ? -1 : findStep(ref);
  if (index === -1) { console.log(red(`No step "${ref}". See \`bun run learn list\`.`)); process.exitCode = 1; return; }
  const { evaluated } = await evaluateAll();
  const result = evaluated[index]!;
  header(index, result);
  const b = await brief(STEPS[index]!);
  if (b.goal) console.log(`\n${b.goal}`);
  sectionList(result, currentSection(result));
  console.log();
  let output = '';
  for (const spec of STEPS[index]!.specs) output += runSpec(spec.file, spec.sections, false);
  await explain(output);
}

function list() {
  STEPS.forEach((s, i) => {
    if (i === 0 || STEPS[i - 1]!.level !== s.level) console.log(bold(`\nLevel ${s.level} · ${LEVELS[s.level]}`));
    console.log(`  ${String(i).padStart(2)} ${s.title} ${dim(s.id)}`);
  });
}

async function check() {
  const problems: string[] = [];
  const owner = new Map<string, string>();
  STEPS.forEach((s, i) => {
    if (!/^\d{2}-[a-z0-9-]+$/.test(s.id) || Number(s.id.slice(0, 2)) !== i) problems.push(`${s.id}: id must be "${String(i).padStart(2, '0')}-<slug>"`);
    if (i > 0 && s.level < STEPS[i - 1]!.level) problems.push(`${s.id}: level goes down`);
  });
  for (const s of STEPS) {
    if (!(await Bun.file(ROOT + briefPath(s)).exists())) problems.push(`${s.id}: missing brief ${briefPath(s)}`);
    const stepSections = new Set<string>();
    for (const spec of s.specs) {
      if (!(await Bun.file(ROOT + spec.file).exists())) { problems.push(`${s.id}: missing spec ${spec.file}`); continue; }
      const present = await sectionsOf(spec.file);
      for (const section of await sectionsFor(spec)) {
        stepSections.add(section);
        if (!present.includes(section)) problems.push(`${s.id}: no section "${section}" in ${spec.file}`);
        const k = key(spec.file, section);
        if (owner.has(k)) problems.push(`"${section}" (${spec.file}) is in both ${owner.get(k)} and ${s.id}`);
        owner.set(k, s.id);
      }
    }
    // Section hints must name sections of this step, so the runner can find them.
    for (const title of (await brief(s)).sections.keys()) {
      if (!stepSections.has(title)) problems.push(`${s.id}: brief has hints for "${title}", which is not a section of this step`);
    }
  }
  for (const file of specFiles()) {
    for (const section of await sectionsOf(file)) {
      if (!owner.has(key(file, section))) problems.push(`no step covers "${section}" (${file})`);
    }
  }
  if (problems.length) {
    console.log(red(`${problems.length} problem(s) in learn/steps.ts or the briefs:`));
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(green(`learn/steps.ts is consistent: ${STEPS.length} steps cover every section of ${specFiles().length} spec files.`));
  }
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, () => unknown> = { status, hint, list, check, step: () => step(arg) };
await (command ? commands[command] ?? (() => { console.log(red(`Unknown command "${command}".`)); process.exitCode = 1; }) : where)();
