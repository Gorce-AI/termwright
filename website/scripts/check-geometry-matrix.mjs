import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FRAMEWORK_OBSERVATION_CAPABILITIES, FRAMEWORK_OPERATION_CAPABILITIES } from '../../packages/protocol/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = await readFile(resolve(here, '../src/content/docs/reference/geometry-visibility.md'), 'utf8');
const names = { generic: 'Generic grid', textual: 'Textual', opentui: 'OpenTUI', ink: 'Ink', tview: 'tview', ratatui: 'Ratatui', charm: 'Charm' };
for (const row of FRAMEWORK_OBSERVATION_CAPABILITIES) {
  const expected = `| ${names[row.framework]} | ${row.identity} | ${row.displayed} | ${row.intendedRect} | ${row.visibleRect} | ${row.hitTest} | ${row.reason} |`;
  if (!page.includes(expected)) {
    throw new Error(`geometry capability docs drifted for ${row.framework}; expected:\n${expected}`);
  }
}
for (const framework of Object.keys(names)) {
  const operations = FRAMEWORK_OPERATION_CAPABILITIES.filter((row) => row.framework === framework);
  const expected = `| ${names[framework]} | ${operations.map((row) => row.availability).join(' | ')} |`;
  if (!page.includes(expected)) throw new Error(`operation capability docs drifted for ${framework}; expected:\n${expected}`);
}
console.log(`geometry and operation matrices match the protocol registry`);
