import {
  AlertTriangle,
  CircleDot,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { ReplayState } from '../domain/model.js';
import { Tooltip } from './Tooltip.js';

interface ReplayControlsProps {
  readonly replay: ReplayState;
  readonly onPlaying: (playing: boolean) => void;
  readonly onSeek: (timeMs: number) => void;
  readonly onSpeed: () => void;
  readonly previewing?: boolean;
}

export function ReplayControls({
  replay,
  onPlaying,
  onSeek,
  onSpeed,
  previewing = false,
}: ReplayControlsProps) {
  const play = replayControlState(replay);
  const steps = [
    ...new Set(
      replay.overview.markers.filter((marker) => marker.kind === 'step').map((marker) => marker.t),
    ),
  ].sort((a, b) => a - b);
  const previous = steps.filter((time) => time < replay.timeMs).at(-1);
  const next = steps.find((time) => time > replay.timeMs);
  const jump = (time: number) => {
    onPlaying(false);
    onSeek(time);
  };
  return (
    <div className="tw-replay-controls" aria-label="Replay controls">
      <Tooltip label={play.label} disabledReason="This recording has no playable duration.">
        <button
          type="button"
          className="tw-icon-button tw-replay-play"
          aria-label={play.label}
          disabled={play.disabled}
          onClick={() => {
            if (play.restart) onSeek(0);
            onPlaying(!replay.playing);
          }}
        >
          {replay.playing ? (
            <Pause aria-hidden="true" size={16} />
          ) : (
            <Play aria-hidden="true" size={16} />
          )}
        </button>
      </Tooltip>
      <Tooltip label="Previous step" disabledReason="There is no earlier step.">
        <button
          type="button"
          className="tw-icon-button"
          aria-label="Previous step"
          disabled={previous === undefined}
          onClick={() => {
            if (previous !== undefined) jump(previous);
          }}
        >
          <SkipBack aria-hidden="true" size={15} />
        </button>
      </Tooltip>
      <Tooltip label="Next step" disabledReason="There is no later step.">
        <button
          type="button"
          className="tw-icon-button"
          aria-label="Next step"
          disabled={next === undefined}
          onClick={() => {
            if (next !== undefined) jump(next);
          }}
        >
          <SkipForward aria-hidden="true" size={15} />
        </button>
      </Tooltip>
      <button
        type="button"
        className="tw-speed-button"
        onClick={onSpeed}
        aria-label={`Playback speed ${replay.speed} times`}
      >
        <Gauge aria-hidden="true" size={14} /> {replay.speed}×
      </button>
      <div className="tw-replay-timeline">
        <input
          className="tw-replay-range"
          aria-label="Replay position"
          aria-description="Left and Right seek 100 milliseconds; hold Shift for one second. Home and End seek to the recording boundaries."
          aria-valuetext={`${format(replay.timeMs)} of ${format(replay.overview.durationMs)}`}
          type="range"
          step="any"
          disabled={play.disabled}
          onKeyDown={(event) => {
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              onSeek(event.key === 'Home' ? 0 : replay.overview.durationMs);
              return;
            }
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const delta = (event.shiftKey ? 1000 : 100) * (event.key === 'ArrowLeft' ? -1 : 1);
            onSeek(Math.min(replay.overview.durationMs, Math.max(0, replay.timeMs + delta)));
          }}
          min={0}
          max={Math.max(replay.overview.durationMs, 1)}
          value={replay.timeMs}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
        />
        <div className="tw-replay-markers" aria-label="Replay markers">
          {replay.overview.markers.map((marker, index) => (
            <button
              key={`${marker.kind}:${marker.t}:${index}`}
              type="button"
              className="tw-replay-marker"
              data-kind={marker.kind}
              aria-label={`Jump to ${marker.label} at ${format(marker.t)}`}
              title={`${marker.label} · ${format(marker.t)}`}
              style={{
                left: `${replay.overview.durationMs <= 0 ? 0 : Math.min(100, Math.max(0, (marker.t / replay.overview.durationMs) * 100))}%`,
              }}
              onClick={() => jump(marker.t)}
            >
              {marker.kind === 'crash' ? (
                <AlertTriangle aria-hidden="true" />
              ) : (
                <CircleDot aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>
      <span className="tw-replay-clock" data-previewing={previewing}>
        {previewing ? <span className="tw-preview-label">Preview </span> : null}
        {format(replay.timeMs)} / {format(replay.overview.durationMs)}
      </span>
      <Tooltip label="Restart replay">
        <button
          type="button"
          className="tw-icon-button"
          aria-label="Restart replay"
          onClick={() => jump(0)}
        >
          <RotateCcw aria-hidden="true" size={15} />
        </button>
      </Tooltip>
    </div>
  );
}

export function replayControlState(replay: Pick<ReplayState, 'playing' | 'timeMs' | 'overview'>): {
  readonly label: string;
  readonly disabled: boolean;
  readonly restart: boolean;
} {
  if (replay.overview.durationMs <= 0)
    return { label: 'Replay unavailable', disabled: true, restart: false };
  if (replay.playing) return { label: 'Pause replay', disabled: false, restart: false };
  if (replay.timeMs >= replay.overview.durationMs)
    return { label: 'Replay from start', disabled: false, restart: true };
  return { label: 'Play replay', disabled: false, restart: false };
}

function format(timeMs: number): string {
  return `${(timeMs / 1_000).toFixed(3)}s`;
}
