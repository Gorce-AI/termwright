import { describe, expect, it } from 'vitest';
import type { ReplayState } from '../domain/model.js';
import { replayControlState } from './ReplayControls.js';

describe('replayControlState', () => {
  it('restarts a finished recording but resumes a paused recording', () => {
    expect(replayControlState(replay(100, 100))).toEqual({
      label: 'Replay from start',
      disabled: false,
      restart: true,
    });
    expect(replayControlState(replay(40, 100))).toEqual({
      label: 'Play replay',
      disabled: false,
      restart: false,
    });
  });

  it('keeps a zero-duration recording safely stopped', () => {
    expect(replayControlState(replay(0, 0))).toEqual({
      label: 'Replay unavailable',
      disabled: true,
      restart: false,
    });
  });
});

function replay(
  timeMs: number,
  durationMs: number,
): Pick<ReplayState, 'playing' | 'timeMs' | 'overview'> {
  return {
    playing: false,
    timeMs,
    overview: { durationMs } as ReplayState['overview'],
  };
}
