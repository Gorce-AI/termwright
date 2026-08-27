import type { ProbeInfo } from '@termwright/protocol';
import { instrumentationSentinel, INK_VERSION } from './instrumentation.js';
import { PACKAGE_VERSION } from './version.js';

/** Static probe identity, kept independent from the render-session runtime. */
export function probeInfo(
  frameworkVersion = instrumentationSentinel()?.frameworkVersion ?? INK_VERSION,
): ProbeInfo {
  return {
    framework: 'ink',
    frameworkVersion,
    probeVersion: PACKAGE_VERSION,
    identityKind: 'stable',
    capabilities: ['stable-identity', 'intended-rect', 'visible-rect', 'annotations'],
    instrumentation: {
      highestTier: 'T3',
      semanticClass: 'A',
      degradedCapabilities: [],
    },
  };
}
