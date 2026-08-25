import { describe, expect, expectTypeOf, it } from 'vitest';
import * as driver from '@termwright/driver';
import type { LaunchTerminalOptions } from '@termwright/driver';
import * as experimental from '@termwright/driver/experimental';

describe('@termwright/driver export tiers', () => {
  it('keeps application-facing sessions on the stable root', () => {
    expect(driver).toHaveProperty('launchTerminal');
    expect(driver).toHaveProperty('TermwrightError');
    expect(driver).not.toHaveProperty('createNodePtyBackend');
    expect(driver).not.toHaveProperty('parseSelector');
    expect(driver).not.toHaveProperty('installTerminalLaunchResourceProvider');
    expectTypeOf<LaunchTerminalOptions>().not.toHaveProperty('backend');
  });

  it('publishes low-level integration seams only from the experimental subpath', () => {
    expect(experimental).toHaveProperty('createNodePtyBackend');
    expect(experimental).toHaveProperty('launchTerminalWithBackend');
    expect(experimental).toHaveProperty('parseSelector');
    expect(experimental).toHaveProperty('installTerminalLaunchResourceProvider');
  });
});
