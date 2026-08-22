import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const registryPath = 'quality/platform-deviations.json';
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
if (registry.version !== 1 || !Array.isArray(registry.deviations)) throw new Error('invalid platform deviation registry');

const files = [];
for (const root of ['packages', 'clients', 'compatibility', 'examples']) await collectSources(root, files);
const observed = new Map();
const pattern = /(?:it|test|describe)\.skipIf\((process\.platform\s*(?:===|!==)\s*["'][^"']+["'])\)\(\s*["']([^"']+)["']/gu;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(pattern)) observed.set(`${file}::${match[2]}`, match[1]);
}

const registered = new Map();
const ids = new Set();
for (const deviation of registry.deviations) {
  for (const field of ['id', 'capability', 'predicate', 'category', 'reason', 'evidence', 'issueOrAdr', 'removalCondition', 'owner', 'revalidate']) {
    if (typeof deviation[field] !== 'string' || deviation[field].length === 0) throw new Error(`${deviation.id ?? '<unknown>'}: missing ${field}`);
  }
  if (ids.has(deviation.id)) throw new Error(`duplicate deviation id ${deviation.id}`);
  ids.add(deviation.id);
  if (!Array.isArray(deviation.tests) || deviation.tests.length === 0) throw new Error(`${deviation.id}: no tests`);
  for (const test of deviation.tests) {
    if (!Array.isArray(test) || test.length !== 2 || !test.every((entry) => typeof entry === 'string' && entry.length > 0)) {
      throw new Error(`${deviation.id}: invalid test reference`);
    }
    const key = `${test[0]}::${test[1]}`;
    if (registered.has(key)) throw new Error(`${key} is registered by both ${registered.get(key)} and ${deviation.id}`);
    registered.set(key, deviation.id);
  }
}

const missing = [...observed.keys()].filter((key) => !registered.has(key));
const stale = [...registered.keys()].filter((key) => !observed.has(key));
if (missing.length > 0 || stale.length > 0) {
  const parts = [];
  if (missing.length > 0) parts.push(`unregistered platform skips:\n${missing.map((key) => `  ${key}`).join('\n')}`);
  if (stale.length > 0) parts.push(`stale deviation entries:\n${stale.map((key) => `  ${key}`).join('\n')}`);
  throw new Error(parts.join('\n'));
}
console.log(`platform deviations: ${ids.size} reasons, ${observed.size} explicit skips, zero drift`);

async function collectSources(path, output) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await collectSources(child, output);
    else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) output.push(child);
  }
}
