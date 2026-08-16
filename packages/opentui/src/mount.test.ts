/**
 * `mountOpenTui` from Node's side.
 *
 * Two halves, because the mount itself cannot run here. The Node half asserts
 * what a Node caller gets — a named error that says which runtime is needed —
 * and the Bun half spawns `testing/mount-fixture.ts` under `bun` and checks
 * what it observed. Between them they cover both runtimes without the package
 * carrying a second test runner.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TermwrightError } from '@termwright/driver';
import { mountOpenTui } from './mount.js';

const FIXTURE = fileURLToPath(new URL('./testing/mount-fixture.ts', import.meta.url));
const DIST_ROOT = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function bunPath(): string | null {
  const override = process.env['TERMWRIGHT_BUN'];
  if (override !== undefined && override.length > 0) return override;
  return spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0 ? 'bun' : null;
}

const bun = bunPath();
const required = process.env['TERMWRIGHT_REQUIRE_CONFORMANCE'] === '1';

describe('under Node', () => {
  it('refuses with a named error naming the runtime it needs', async () => {
    // Guard against the test itself running under Bun, where the mount works.
    if (typeof process.versions.bun === 'string') return;

    const failure = await mountOpenTui(() => undefined).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TermwrightError);
    const error = failure as TermwrightError;
    expect(error.code).toBe('unsupported-action');
    expect(error.message).toContain('requires Bun');
    expect(error.message).toContain('bun:ffi');
    // The way out has to be in the error, not only in the docs.
    expect(error.diagnostics.suggestion).toContain('bun');
    expect(error.diagnostics.suggestion).toContain('launchTerminal');
  });

  it('fails before reaching OpenTUI, so the reason is ours and not an FFI stack', async () => {
    if (typeof process.versions.bun === 'string') return;

    const failure = await mountOpenTui(() => undefined).catch((error: unknown) => error);
    expect(String(failure)).not.toContain('native FFI is not available');
  });
});

describe('the adapter entry point', () => {
  it('does not carry the driver into a production install', () => {
    // The mount is on a subpath so that an application instrumenting itself
    // never pulls a pty binary. If `dist/index.js` ever imports the driver,
    // that promise is gone — and only the build output can prove it.
    if (!existsSync(DIST_ROOT)) return;
    const bundle = readFileSync(DIST_ROOT, 'utf8');
    expect(bundle).not.toContain('@termwright/driver');
    expect(bundle).not.toContain('@termwright/ink-testing');
  });
});

describe.skipIf(bun === null && !required)('under Bun', () => {
  it(
    'mounts a real scene, resolves it semantically, and settles on committed frames',
    () => {
      if (bun === null) {
        expect.fail(
          'bun is not on PATH and TERMWRIGHT_REQUIRE_CONFORMANCE=1 is set: the mount could ' +
            'not be exercised (@opentui/core loads its native library through bun:ffi)',
        );
      }

      const run = spawnSync(bun, [FIXTURE], { encoding: 'utf8', timeout: 60_000 });
      const line = run.stdout.trim().split('\n').at(-1) ?? '';
      const result = JSON.parse(line || '{}') as {
        ok?: boolean;
        error?: string;
        checks?: Record<string, unknown>;
      };

      expect(result, `stderr: ${run.stderr}`).toMatchObject({ ok: true });
      expect(result.checks).toEqual({
        semanticTree: true,
        adapter: '@termwright/opentui',
        buttonRef: true,
        semanticMatch: true,
        // Viewport-absolute, straight from screenX/screenY: the scene placed
        // the button at column 2, row 1 and made it 13 cells wide.
        rect: { row: 1, column: 2, width: 13, height: 1 },
        // The handler ran because a mouse report arrived on stdin, not because
        // anything called it.
        clicksAfterClick: 1,
        screenAfterCommit: true,
        statusText: 'Committed',
      });
    },
    90_000,
  );
});
