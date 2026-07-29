import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fails if the CI e2e shards do not, between them, run every Playwright test
 * exactly once.
 *
 * The shards are defined by spec file and tag (see .github/workflows/ci.yml)
 * because that is what lets each job be named for what it covers and kept to a
 * similar length. The hazard of splitting that way is silent: add a spec file
 * that no shard's filter happens to select and it simply never runs, with CI
 * staying green and reporting nothing missing. A duplicate is the milder
 * inverse — wasted minutes on the critical path.
 *
 * Comparing the union of the shards against the full suite turns both of those
 * into an ordinary red build.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Reads the `name:`/`filter:` pairs out of the e2e matrix.
 *
 * Deliberately a narrow regex rather than a YAML dependency: this reads one
 * block of one file that lives in this repo. It asserts on what it found so a
 * reformat that breaks the pattern fails the check loudly instead of silently
 * verifying an empty list of shards.
 */
function readShards() {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const matrix = workflow.split(/^\s*matrix:\s*$/m)[1];
  if (!matrix) throw new Error('could not locate the e2e matrix block in ci.yml');

  const shards = [...matrix.matchAll(/-\s*name:\s*(\S+)\s*\n\s*filter:\s*(.+)$/gm)].map((m) => ({
    name: m[1],
    filter: m[2].trim().replace(/^'(.*)'$/, '$1'),
  }));
  if (shards.length < 2) throw new Error(`parsed only ${shards.length} shard(s) from ci.yml`);
  return shards;
}

// Each `--list` spends a second or two loading the Playwright config and the
// spec files, and there is one per shard. Serially that grew with the shard
// count and put this check on the critical path it exists to protect; these
// are independent read-only processes, so run them together.
const execFileAsync = promisify(execFile);

async function listTests(args) {
  let out;
  try {
    ({ stdout: out } = await execFileAsync(
      'npx',
      ['playwright', 'test', ...args, '--list', '--reporter=json'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (error) {
    // Usually a malformed --grep. Playwright reports it inside the JSON on
    // stdout, so surface that one line rather than the whole config dump.
    const reason = JSON.parse(error.stdout ?? '{}').errors?.[0]?.message ?? error.message;
    throw new Error(`\`playwright test ${args.join(' ')} --list\` failed: ${reason}`);
  }
  const report = JSON.parse(out);
  const ids = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) ids.push(`${spec.file}:${spec.line} ${spec.title}`);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return ids;
}

const shards = readShards();
const [all, ...perShard] = await Promise.all([
  listTests([]),
  // Mirrors how the workflow invokes it: `npm run test:e2e -- <filter>`.
  ...shards.map((shard) =>
    listTests((shard.filter.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, ''))),
  ),
]);

const seen = new Map();
for (const [i, ids] of perShard.entries()) {
  console.log(`  ${shards[i].name}: ${ids.length} test(s)`);
  for (const id of ids) {
    seen.set(id, [...(seen.get(id) ?? []), shards[i].name]);
  }
}

const missing = all.filter((id) => !seen.has(id));
const duplicated = [...seen.entries()].filter(([, names]) => names.length > 1);

for (const id of missing) console.error(`NOT RUN BY ANY SHARD: ${id}`);
for (const [id, names] of duplicated) console.error(`RUN BY ${names.join(' + ')}: ${id}`);

if (missing.length || duplicated.length) {
  console.error(`\n${all.length} tests total, ${seen.size} covered by ${shards.length} shards.`);
  process.exit(1);
}

console.log(`All ${all.length} e2e tests are covered by exactly one of ${shards.length} shards.`);
