import { AlertTriangle, CircleDot, Gauge, Pause, Play, RotateCcw } from 'lucide-react';
import type { ReplayState } from '../domain/model.js';
import { Tooltip } from './Tooltip.js';

interface ReplayControlsProps {
  readonly replay: ReplayState;
  readonly onPlaying: (playing: boolean) => void;
  readonly onSeek: (timeMs: number) => void;
  readonly onSpeed: () => void;
}

export function ReplayControls({ replay, onPlaying, onSeek, onSpeed }: ReplayControlsProps) {
  const play = replayControlState(replay);
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
      <button
        type="button"
        className="tw-speed-button"
        onClick={onSpeed}
        aria-label={`Playback speed ${replay.speed} times`}
      >
        <Gauge aria-hidden="true" size={14} /> {replay.speed}×
      </button>
      <input
        className="tw-replay-range"
        aria-label="Replay position"
        type="range"
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
            onClick={() => onSeek(marker.t)}
          >
            {marker.kind === 'crash' ? (
              <AlertTriangle aria-hidden="true" />
            ) : (
              <CircleDot aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      <span className="tw-replay-clock">
        {format(replay.timeMs)} / {format(replay.overview.durationMs)}
      </span>
      <Tooltip label="Restart replay">
        <button
          type="button"
          className="tw-icon-button"
          aria-label="Restart replay"
          onClick={() => onSeek(0)}
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
  return `${(timeMs / 1_000).toFixed(1)}s`;
}
