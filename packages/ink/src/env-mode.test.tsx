/**
 * What `envMode` means in each mode — the one place the two harnesses are
 * genuinely not interchangeable.
 *
 * A fixture is a separate process, so its `process.env` is exactly what the
 * driver built: `'replace'` is real isolation, and a variable on a developer's
 * laptop cannot reach the component. A mount shares the runner's process, so
 * the component reads the runner's `process.env` no matter what the session was
 * told; `envMode` shapes only the environment handed to the adapter.
 *
 * These are assertions rather than prose because the difference is easy to
 * assume away, and assuming wrongly means a test that passes locally and fails
 * in CI, or worse, the reverse.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { it as resourceAwareIt } from '@termwright/test';
import type { TerminalHarness } from '@termwright/driver';
import { launchInkFixture } from './fixture.js';
import { mountInk } from './mount.js';
import EnvApp from './testing/env-app.mjs';

const COMPONENT = new URL('./testing/env-app.mjs', import.meta.url);
const SIZE = { columns: 60, rows: 6 } as const;
const fixtureIt = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });
const PROBE = 'TW_PROBE';
const INSTRUMENTATION_ENV = [
  'TERMWRIGHT_ENDPOINT',
  'TERMWRIGHT_TOKEN',
  'TERMWRIGHT_FIXTURE_CONTROL',
  'TERMWRIGHT_FIXTURE_CONTROL_TOKEN',
] as const;

const open: TerminalHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
  delete process.env[PROBE];
});

function track<T extends TerminalHarness>(harness: T): T {
  open.push(harness);
  return harness;
}

describe('launchInkFixture', () => {
  fixtureIt('does not leak the runner environment into the fixture by default', async () => {
    process.env[PROBE] = 'from-the-runner';

    const harness = track(await launchInkFixture({ component: COMPONENT, ...SIZE }));

    expect(harness.screen().text()).toContain(`${PROBE}=<unset>`);
    // The allowlist is what makes the process usable at all; without PATH the
    // isolation would be indistinguishable from a broken spawn.
    expect(harness.screen().text()).toContain('PATH=<set>');
  });

  fixtureIt('passes explicit variables through', async () => {
    const harness = track(
      await launchInkFixture({ component: COMPONENT, env: { [PROBE]: 'explicit' }, ...SIZE }),
    );

    expect(harness.screen().text()).toContain(`${PROBE}=explicit`);
  });

  fixtureIt('inherits the runner environment when asked to', async () => {
    process.env[PROBE] = 'inherited';

    const harness = track(
      await launchInkFixture({ component: COMPONENT, envMode: 'inherit', ...SIZE }),
    );

    expect(harness.screen().text()).toContain(`${PROBE}=inherited`);
  });
});

describe('mountInk', () => {
  it('cannot isolate the component from the runner environment', async () => {
    process.env[PROBE] = 'from-the-runner';

    // `'replace'` is honoured for the session — it is what the adapter is
    // handed — but the component calls `process.env` on the runner's own
    // object, and a mount never mutates that. Documented, asserted, and the
    // reason launchInkFixture exists.
    const harness = track(
      await mountInk(createElement(EnvApp, {}), { ...SIZE, envMode: 'replace' }),
    );

    expect(harness.screen().text()).toContain(`${PROBE}=from-the-runner`);
  });

  it('still keeps its own instrumentation out of the runner environment', async () => {
    const harness = track(await mountInk(createElement(EnvApp, {}), SIZE));

    expect(harness.contract()?.capabilities['semantic-tree'].status).toBe('supported');
    for (const key of INSTRUMENTATION_ENV) expect(process.env[key]).toBeUndefined();
  });
});
