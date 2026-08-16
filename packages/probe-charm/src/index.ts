/**
 * `@termwright/probe-charm` — semantics from a Bubble Tea application that
 * imports nothing of ours.
 *
 * Two majors, two strategies. The module path is what tells them apart, and it
 * is not the same name with a suffix: v2 lives at `charm.land/bubbletea/v2`.
 *
 * @packageDocumentation
 */

export * from '@termwright/probe-go';

export {
  BUBBLETEA_MODULES,
  COMPANION_MODULES,
  CharmDetectionError,
  capabilitiesFor,
  detectCharmFlavour,
  reportsGeometry,
  type CharmFlavour,
  type CharmMajor,
} from './detect.js';
