import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveVitestBin, UI_URL_ENV } from './ui-command.js';

/** The monorepo root, which is a real project with Vitest installed. */
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('resolveVitestBin', () => {
  it('finds the project’s own Vitest binary', () => {
    const bin = resolveVitestBin(projectRoot);
    expect(existsSync(bin)).toBe(true);
    expect(bin).toContain('vitest');
  });

  // The "no Vitest installed" branch is not exercised here on purpose: Node's
  // resolver falls back to the global module folders, so no path on a developer
  // machine reliably lacks Vitest. What matters — that the failure reaches the
  // user and the runner still shuts down — is asserted end to end in
  // `cli.test.ts`, "closes the runner even when starting the suite throws".
});

describe('the reporter contract', () => {
  it('publishes to the variable @termwright/ui reads', () => {
    expect(UI_URL_ENV).toBe('TERMWRIGHT_UI_URL');
  });
});
