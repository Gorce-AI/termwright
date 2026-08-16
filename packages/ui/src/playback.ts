/**
 * Playback: replaying a recording the way a video plays, rather than by
 * dragging a scrubber.
 *
 * The archive is a list of frames with real timestamps, so playing it is a
 * clock problem: advance a position, write out everything the recording emitted
 * between the old position and the new one, repeat. Idle gaps were already
 * trimmed at record time by the writer, so a recording of a test that waited
 * two seconds for a spinner plays back as fast as its `idleTimeLimit` allows —
 * which is what makes watching a whole suite bearable.
 *
 * This module is the clock and the bookkeeping, with no DOM and no terminal:
 * the page owns those, and this owns "what should have happened by now".
 *
 * @packageDocumentation
 */

/** One recorded frame: output to write, or a resize to apply. */
export interface PlaybackFrame {
  /** Position on the cast timeline, in milliseconds. */
  readonly t: number;
  readonly kind: 'output' | 'resize';
  /** Base64 UTF-8 of the output, for `output` frames. */
  readonly dataB64?: string;
  readonly columns?: number;
  readonly rows?: number;
}

/** Playback speeds the UI offers. */
export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;

/** One of {@link PLAYBACK_SPEEDS}. */
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Where playback is. */
export interface PlaybackState {
  /** Current position on the cast timeline, in milliseconds. */
  readonly timeMs: number;
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  /** Index of the first frame not yet written. */
  readonly cursor: number;
}

/** A fresh, paused playback at the start of the recording. */
export function initialPlayback(): PlaybackState {
  return { timeMs: 0, playing: false, speed: 1, cursor: 0 };
}

/**
 * Advances the clock by `elapsedMs` of wall time.
 *
 * @returns the new state; `playing` turns off on reaching the end, so the
 * button flips to "play" and pressing it restarts from the beginning.
 */
export function advance(
  state: PlaybackState,
  elapsedMs: number,
  durationMs: number,
): PlaybackState {
  if (!state.playing) return state;
  const next = state.timeMs + elapsedMs * state.speed;
  if (next >= durationMs) return { ...state, timeMs: durationMs, playing: false };
  return { ...state, timeMs: next };
}

/**
 * Frames to apply for a move from the current cursor to `timeMs`.
 *
 * Moving **forward** returns the frames in between. Moving **backward** cannot
 * un-write a terminal, so it reports `rewind: true` and returns every frame
 * from the start: the caller resets its emulator and replays. That is exactly
 * what a scrub backwards does today, and it keeps one code path for both.
 */
export function framesUpTo(
  frames: readonly PlaybackFrame[],
  state: PlaybackState,
  timeMs: number,
): { readonly frames: readonly PlaybackFrame[]; readonly cursor: number; readonly rewind: boolean } {
  const previous = state.cursor === 0 ? -Infinity : (frames[state.cursor - 1]?.t ?? -Infinity);
  if (timeMs < previous) {
    let cursor = 0;
    while (cursor < frames.length && (frames[cursor] as PlaybackFrame).t <= timeMs) cursor += 1;
    return { frames: frames.slice(0, cursor), cursor, rewind: true };
  }
  let cursor = state.cursor;
  while (cursor < frames.length && (frames[cursor] as PlaybackFrame).t <= timeMs) cursor += 1;
  return { frames: frames.slice(state.cursor, cursor), cursor, rewind: false };
}

/** Next speed in the ladder, wrapping — what the speed button cycles through. */
export function nextSpeed(speed: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(speed);
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length] as PlaybackSpeed;
}

/**
 * The newest semantic revision at or before `timeMs`, from the revision
 * markers the overview already carries. Playback uses it to know when the tree
 * on screen went stale and a new one has to be fetched.
 */
export function revisionAt(
  revisions: readonly { readonly t: number; readonly revision: number }[],
  timeMs: number,
): number | null {
  let found: number | null = null;
  for (const entry of revisions) {
    if (entry.t > timeMs) break;
    found = entry.revision;
  }
  return found;
}
