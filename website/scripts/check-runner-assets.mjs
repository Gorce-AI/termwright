import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../public/images/runner/', import.meta.url);
const expected = [
  'spec-catalog.png',
  'active-run.png',
  'replay-player.png',
  'failure-inspection.png',
  'semantics-inspector.png',
  'run-history.png',
  'recorder.png',
  'recorder-active.png',
  'recorder-review.png',
  'settings.png',
  'html-report.png',
];

for (const name of expected) {
  const file = join(root.pathname, name);
  const details = await stat(file);
  if (!details.isFile() || details.size < 10_000) {
    throw new Error(`Runner documentation asset is missing or too small: ${name}`);
  }
}

console.log(`Runner documentation assets: ${expected.length}/${expected.length}`);
