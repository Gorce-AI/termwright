/** Truthful gate for Ink's live-region coordinates. */

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
    ?? (!(options.inCi ?? runningInCi()) && options.stdoutIsTTY);
  return options.alternateScreen && interactive && options.stdoutIsTTY;
}

function runningInCi(): boolean {
  return enabledEnvironmentFlag('CI') || enabledEnvironmentFlag('CONTINUOUS_INTEGRATION');
}

function enabledEnvironmentFlag(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== '0' && value !== 'false';
}
