/**
 * The fixture runner, driven directly with payloads `launchInkFixture` would
 * never produce.
 *
 * The runner validates its own input rather than trusting the encoder, because
 * it is a separate program: anything on a developer's machine can start it, and
 * "the caller already checked" is not a property a process boundary preserves.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const runner = fileURLToPath(new URL('../runner/runner-entry.mjs', import.meta.url));
const run = promisify(execFile);

interface RunResult {
  readonly code: number;
  readonly stderr: string;
}

async function runWith(payload: string | undefined): Promise<RunResult> {
  try {
    await run(process.execPath, payload === undefined ? [runner] : [runner, payload]);
    return { code: 0, stderr: '' };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { code: failure.code ?? -1, stderr: failure.stderr ?? '' };
  }
}

describe('runner-entry', () => {
  it('refuses a missing payload', async () => {
    const result = await runWith(undefined);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('missing payload');
  });

  it('refuses a payload that is not JSON', async () => {
    const result = await runWith('{not json');

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('not valid JSON');
  });

  it('refuses an unknown payload version', async () => {
    const result = await runWith(
      JSON.stringify({ v: 99, module: 'file:///x.mjs', exportName: 'default', props: {}, maxFps: 30 }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unsupported payload version');
  });

  it('refuses a module that is not a file URL', async () => {
    // Importing over the network, or from a bare specifier resolved in the
    // fixture's own tree, is not something a test should be able to ask for.
    const result = await runWith(
      JSON.stringify({
        v: 1,
        module: 'https://example.invalid/component.mjs',
        exportName: 'default',
        props: {},
        maxFps: 30,
      }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('file: URL');
  });

  it('refuses props that are not an object', async () => {
    const result = await runWith(
      JSON.stringify({ v: 1, module: 'file:///x.mjs', exportName: 'default', props: [1, 2], maxFps: 30 }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('props must be a JSON object');
  });

  it('refuses an oversized payload without parsing it', async () => {
    const result = await runWith(`{"v":1,"pad":"${'x'.repeat(70_000)}"}`);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('larger than');
  });

  it('refuses a module that cannot be imported', async () => {
    const result = await runWith(
      JSON.stringify({
        v: 1,
        module: new URL('./testing/does-not-exist.mjs', import.meta.url).href,
        exportName: 'default',
        props: {},
        maxFps: 30,
      }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot import');
  });

  it('refuses an export that is not a component', async () => {
    const result = await runWith(
      JSON.stringify({
        v: 1,
        module: new URL('./testing/counter-app.mjs', import.meta.url).href,
        exportName: 'SGR_MOUSE',
        props: {},
        maxFps: 30,
      }),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/is (missing|a \w+), not a component/u);
  });
});
