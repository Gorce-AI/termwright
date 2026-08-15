/**
 * The umbrella's promise is that a project can put one package in
 * `devDependencies` and write everything from there — including its Vitest
 * config. These assertions are the cheap version of that promise: every
 * subpath resolves, and the two reporter subpaths carry the **default** export
 * a config imports (`export *` alone does not re-export a default, which is
 * exactly the mistake this catches).
 */
import { describe, expect, it } from 'vitest';

describe('subpath entry points', () => {
  it('exposes the driver from the root, with no test-runner import', async () => {
    const root = await import('./index.js');
    expect(root.launchTerminal).toBeTypeOf('function');
    expect(root.TermwrightError).toBeTypeOf('function');
  });

  it('exposes the Vitest preset from termwright/test', async () => {
    const preset = await import('./test.js');
    expect(preset.test).toBeTypeOf('function');
    expect(preset.expect).toBeTypeOf('function');
  });

  it('exposes Ink component testing from termwright/ink', async () => {
    const ink = await import('./ink.js');
    expect(ink.mountInk).toBeTypeOf('function');
    expect(ink.launchInkFixture).toBeTypeOf('function');
  });

  it('exposes the trace reporter, default export included', async () => {
    const reporter = await import('./reporter.js');
    expect(reporter.default).toBeTypeOf('function');
    expect(new reporter.default()).toBeInstanceOf(reporter.TermwrightReporter);
  });

  it('exposes the runner reporter, default export included', async () => {
    const reporter = await import('./ui-reporter.js');
    expect(reporter.default).toBeTypeOf('function');
    expect(new reporter.default()).toBeInstanceOf(reporter.TermwrightUiReporter);
    // The variable `termwright ui` sets, on both sides of the handoff.
    expect(reporter.UI_URL_ENV).toBe('TERMWRIGHT_UI_URL');
  });
});
