// Generates openapi.json (from the built server) and src/schema.ts (with openapi-typescript).
// `node scripts/generate.mjs write` updates the files. `node scripts/generate.mjs check` fails when they are out of date.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const mode = process.argv[2];
if (mode !== 'write' && mode !== 'check') {
  console.error('usage: node scripts/generate.mjs write|check');
  process.exit(2);
}

const cli = here('../../../apps/server/dist/cli.js');
const spec = execFileSync(process.execPath, [cli, 'openapi'], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } });
const header = '// Generated from openapi.json by scripts/generate.mjs. Do not edit: run `pnpm api:generate`.\n\n';
const schema = header + astToString(await openapiTS(JSON.parse(spec), { alphabetize: true }));

const outputs = [
  [here('../openapi.json'), spec],
  [here('../src/schema.ts'), schema],
];

let stale = 0;
for (const [path, text] of outputs) {
  const current = await readFile(path, 'utf8').catch(() => '');
  if (current === text) continue;
  if (mode === 'write') {
    await writeFile(path, text);
    console.log(`wrote ${path}`);
  } else {
    stale++;
    console.error(`out of date: ${path}`);
  }
}
if (stale) {
  console.error('The generated API client does not match the server. Run `pnpm api:generate` and commit the result.');
  process.exit(1);
}
if (mode === 'check') console.log('generated API client is up to date');
