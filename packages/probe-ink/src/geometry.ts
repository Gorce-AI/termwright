/** Truthful gate for Ink's live-region coordinates. */

import isInCi from 'is-in-ci';

export interface GeometryGateOptions {
  readonly alternateScreen: boolean;
  readonly interactive?: boolean;
  readonly stdoutIsTTY: boolean;
  /** Injectable only so the default-interactivity branch is deterministic. */
  readonly inCi?: boolean;
}

/**
 * Reproduce Ink 7's `resolveInteractiveOption` and
 * `resolveAlternateScreenOption`. Layout coordinates are terminal-absolute
 * only if Ink actually entered the alternate screen on a TTY.
 */
export function canPublishInkGeometry(options: GeometryGateOptions): boolean {
  const interactive = options.interactive
    ?? (!(options.inCi ?? isInCi) && options.stdoutIsTTY);
  return options.alternateScreen && interactive && options.stdoutIsTTY;
}
