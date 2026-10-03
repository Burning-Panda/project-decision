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
interface StepResult extends Tally { status: Status }

async function sectionsFor(spec: StepSpec) { return spec.sections ?? (await sectionsOf(spec.file)); }

async function evaluate(step: Step, results: Results): Promise<StepResult> {
  const total: StepResult = { pass: 0, fail: 0, skip: 0, status: 'todo' };
  for (const spec of step.specs) {
    for (const section of await sectionsFor(spec)) {
      const t = results.get(key(spec.file, section));
      if (!t) continue;
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

async function brief(step: Step) {
  const text = await Bun.file(ROOT + briefPath(step)).text().catch(() => '');
  const section = (title: string) => text.split(new RegExp(`^## ${title}\\s*$`, 'm'))[1]?.split(/^## /m)[0]?.trim() ?? '';
  const hints = section('Hints').split(/^### .*$/m).slice(1).map((h) => h.trim()).filter(Boolean); // [0] is the intro line
  return { goal: section('Goal'), hints };
}

// ---------------------------------------------------------------- output
function header(index: number, result?: StepResult) {
  const step = STEPS[index]!;
  console.log(`${dim(`Level ${step.level} · ${LEVELS[step.level]}`)}`);
  console.log(bold(`Step ${index} of ${STEPS.length - 1} — ${step.title}`));
  if (step.edit.length) console.log(`${dim('Edit: ')} ${step.edit.join(', ')}`);
  console.log(`${dim('Brief:')} ${briefPath(step)}`);
  console.log(`${dim('Specs:')} ${step.specs.map((s) => s.file + (s.sections ? ` (${s.sections.length} section${s.sections.length > 1 ? 's' : ''})` : '')).join(', ')}`);
  if (result) console.log(`${dim('Tests:')} ${result.pass} of ${result.pass + result.fail + result.skip} pass`);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs a step's specs with bun's own output; stops at the first spec file with a failure when `bail`. */
function runStep(step: Step, bail: boolean) {
  for (const spec of step.specs) {
    const args = ['bun', 'test', `./${spec.file}`, '--only-failures'];
    if (spec.sections) args.push('-t', `^(?:${spec.sections.map(escapeRegex).join('|')}) `);
    if (bail) args.push('--bail');
    const run = Bun.spawnSync(args, { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
    if (run.exitCode !== 0 && bail) return;
  }
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
  header(current, result);
  const { goal } = await brief(step);
  if (goal) console.log(`\n${goal}\n`);
  console.log(dim('First failing test:'));
  runStep(step, true);
  console.log(dim(`\nMake it pass, then run \`bun run learn\` again. Stuck? \`bun run learn hint\`.`));
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
  const { current } = await evaluateAll();
  if (current === -1) return console.log('Nothing left to hint at: every step is done.');
  const step = STEPS[current]!;
  const { hints } = await brief(step);
  if (!hints.length) return console.log(`No hints written for ${step.id} yet.`);
  const shown = Math.min((state.hints[step.id] ?? 0) + 1, hints.length);
  for (let i = 0; i < shown; i++) console.log(`${bold(`Hint ${i + 1} of ${hints.length}`)}\n${hints[i]}\n`);
  if (shown === hints.length) console.log(dim('That was the last hint.'));
  await writeState({ ...state, hints: { ...state.hints, [step.id]: shown } });
}

async function step(ref: string | undefined) {
  const index = ref === undefined ? -1 : findStep(ref);
  if (index === -1) { console.log(red(`No step "${ref}". See \`bun run learn list\`.`)); process.exitCode = 1; return; }
  const { evaluated } = await evaluateAll();
  header(index, evaluated[index]);
  const { goal } = await brief(STEPS[index]!);
  if (goal) console.log(`\n${goal}\n`);
  runStep(STEPS[index]!, false);
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
    for (const spec of s.specs) {
      if (!(await Bun.file(ROOT + spec.file).exists())) { problems.push(`${s.id}: missing spec ${spec.file}`); continue; }
      const present = await sectionsOf(spec.file);
      for (const section of await sectionsFor(spec)) {
        if (!present.includes(section)) problems.push(`${s.id}: no section "${section}" in ${spec.file}`);
        const k = key(spec.file, section);
        if (owner.has(k)) problems.push(`"${section}" (${spec.file}) is in both ${owner.get(k)} and ${s.id}`);
        owner.set(k, s.id);
      }
    }
  }
  for (const file of specFiles()) {
    for (const section of await sectionsOf(file)) {
      if (!owner.has(key(file, section))) problems.push(`no step covers "${section}" (${file})`);
    }
  }
  if (problems.length) {
    console.log(red(`${problems.length} problem(s) in learn/steps.ts:`));
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(green(`learn/steps.ts is consistent: ${STEPS.length} steps cover every section of ${specFiles().length} spec files.`));
  }
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, () => unknown> = { status, hint, list, check, step: () => step(arg) };
await (command ? commands[command] ?? (() => { console.log(red(`Unknown command "${command}".`)); process.exitCode = 1; }) : where)();
