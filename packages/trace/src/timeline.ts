/**
 * The wall-clock → cast-timeline transform.
 *
 * A recording's cast timeline is *not* wall-clock time: windows between
 * {@link TraceWriter.hide} and {@link TraceWriter.show} are removed entirely,
 * and gaps longer than the export-time idle limit are shortened. Every artefact
 * that must line up with the recording — semantic snapshots, step markers,
 * action events — therefore stores a `castOffset` computed through this module.
 */

/** A half-open wall-clock interval `[start, end)` excluded from the recording. */
export interface HiddenWindow {
  readonly start: number;
  /** `Number.POSITIVE_INFINITY` while a hide window is still open. */
  readonly end: number;
}

/** Inputs to {@link buildCastTimeline}. */
export interface TimelineOptions {
  /** Windows excluded by `hide()`/`show()`. Need not be sorted or disjoint. */
  readonly hidden?: readonly HiddenWindow[];
  /** Maximum retained gap between consecutive events, in milliseconds. */
  readonly idleTimeLimitMs?: number;
}

/** Total length of `[from, to)` covered by `windows`, in milliseconds. */
export function hiddenOverlap(from: number, to: number, windows: readonly HiddenWindow[]): number {
  if (to <= from || windows.length === 0) return 0;
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  let covered = 0;
  let cursor = from;
  for (const window of sorted) {
    const start = Math.max(window.start, cursor);
    const end = Math.min(window.end, to);
    if (end > start) {
      covered += end - start;
      cursor = end;
    }
    if (cursor >= to) break;
  }
  return covered;
}

/**
 * A monotone, piecewise-linear map from wall-clock offsets to cast offsets.
 *
 * Knots are the retained cast events. A time that falls between two knots (a
 * semantic snapshot recorded mid-gap, say) is interpolated proportionally, so
 * it lands inside the *compressed* gap rather than past its end.
 */
export class CastTimeline {
  readonly #wall: readonly number[];
  readonly #cast: readonly number[];
  readonly #hidden: readonly HiddenWindow[];
  readonly #idleLimitMs: number;

  /** @internal Use {@link buildCastTimeline}. */
  constructor(
    wall: readonly number[],
    cast: readonly number[],
    hidden: readonly HiddenWindow[],
    idleLimitMs: number,
  ) {
    this.#wall = wall;
    this.#cast = cast;
    this.#hidden = hidden;
    this.#idleLimitMs = idleLimitMs;
  }

  /** Cast offset of the i-th retained event, in milliseconds. */
  castTimeAt(index: number): number {
    return this.#cast[index + 1] ?? 0;
  }

  /** All retained event cast offsets, in milliseconds. */
  castTimes(): readonly number[] {
    return this.#cast.slice(1);
  }

  /** Cast offset of the last retained event, in milliseconds. */
  get durationMs(): number {
    return this.#cast[this.#cast.length - 1] ?? 0;
  }

  /** True when `wallMs` falls inside a `hide()` window. */
  isHidden(wallMs: number): boolean {
    return this.#hidden.some((w) => wallMs >= w.start && wallMs < w.end);
  }

  /**
   * Maps a wall-clock offset onto the cast timeline.
   *
   * Times inside a hidden window collapse onto the window's start; times after
   * the last event extend the timeline with the same hidden/idle rules.
   */
  mapWall(wallMs: number): number {
    const wall = this.#wall;
    const cast = this.#cast;
    if (wallMs <= (wall[0] ?? 0)) return cast[0] ?? 0;

    let low = 0;
    let high = wall.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((wall[mid] ?? 0) <= wallMs) low = mid;
      else high = mid - 1;
    }

    const leftWall = wall[low] ?? 0;
    const leftCast = cast[low] ?? 0;
    if (low === wall.length - 1) {
      const visible = wallMs - leftWall - hiddenOverlap(leftWall, wallMs, this.#hidden);
      return leftCast + Math.min(visible, this.#idleLimitMs);
    }

    const rightWall = wall[low + 1] ?? leftWall;
    const rightCast = cast[low + 1] ?? leftCast;
    const span = rightWall - leftWall;
    if (span <= 0) return rightCast;
    const ratio = (wallMs - leftWall) / span;
    return leftCast + (rightCast - leftCast) * ratio;
  }
}

/**
 * Computes cast offsets for a sorted list of retained event wall times.
 *
 * @param eventWallTimes - non-decreasing wall-clock offsets (ms) of the events
 *   that survive into `session.cast`; events inside hidden windows must already
 *   have been dropped by the caller.
 */
export function buildCastTimeline(
  eventWallTimes: readonly number[],
  options: TimelineOptions = {},
): CastTimeline {
  const hidden = normaliseWindows(options.hidden ?? []);
  const idleLimitMs =
    options.idleTimeLimitMs === undefined || options.idleTimeLimitMs <= 0
      ? Number.POSITIVE_INFINITY
      : options.idleTimeLimitMs;

  const wall: number[] = [0];
  const cast: number[] = [0];
  let previousWall = 0;
  let previousCast = 0;

  for (const eventWall of eventWallTimes) {
    const clamped = Math.max(eventWall, previousWall);
    const raw = clamped - previousWall;
    const visible = Math.max(0, raw - hiddenOverlap(previousWall, clamped, hidden));
    previousCast += Math.min(visible, idleLimitMs);
    previousWall = clamped;
    wall.push(clamped);
    cast.push(previousCast);
  }

  return new CastTimeline(wall, cast, hidden, idleLimitMs);
}

/** Merges overlapping windows and drops empty ones. */
function normaliseWindows(windows: readonly HiddenWindow[]): readonly HiddenWindow[] {
  const sorted = windows.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const merged: HiddenWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && window.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, window.end) };
    } else {
      merged.push(window);
    }
  }
  return merged;
}
