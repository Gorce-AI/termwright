/**
 * Self-certification: the shared adapter contract suite, run against a real
 * OpenTUI application in a real pseudo-terminal.
 *
 * The suite imports nothing from this package — it observes bytes and frames —
 * so passing it means the same thing here as it does for the Ink adapter or
 * for a Python one.
 *
 * Two things gate it, and both are honest skips rather than silent passes:
 * `bun` must be on PATH, because `@opentui/core` 0.5.3 loads its native
 * library through `bun:ffi` (NOTES.md, "Bun-only runtime"), and `dist/` must
 * exist, because the fixture deliberately runs against the build output.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { runAdapterConformance } from '@termwright/conformance';

const FIXTURE = fileURLToPath(new URL('./testing/fixture-app.ts', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));

/** The `bun` executable, or `null` when the runtime OpenTUI needs is absent. */
function bunPath(): string | null {
  const override = process.env['TERMWRIGHT_BUN'];
  if (override !== undefined && override.length > 0) return override;
  const probe = spawnSync('bun', ['--version'], { stdio: 'ignore' });
  return probe.status === 0 ? 'bun' : null;
}

const bun = bunPath();
const ready = bun !== null && existsSync(DIST);

if (ready) {
  await runAdapterConformance({
    name: '@termwright/opentui',
    spawn: () => ({ command: [bun as string, FIXTURE] }),
    baseline: () => ({ command: [bun as string, FIXTURE, '--plain'] }),
    ready: 'Ready',
    interaction: { input: '\t', expect: 'Committed' },
    quit: { input: 'q', exitCode: 0 },
    columns: 60,
    rows: 16,
    expectAbsoluteBounds: true,
  });
} else {
  describe('adapter conformance: @termwright/opentui', () => {
    it.skip(
      bun === null
        ? 'needs bun on PATH (@opentui/core loads its native library through bun:ffi)'
        : 'needs `pnpm build` first (the fixture runs against dist/)',
      () => undefined,
    );
  });
}
