import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import { Radio, ScanLine } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlaybackFrame } from '../../playback.js';
import type { TerminalHighlight } from '../domain/terminal-highlight.js';

interface TerminalStageProps {
  readonly identity: string;
  readonly mode: 'empty' | 'live' | 'replay';
  readonly columns: number;
  readonly rows: number;
  readonly profile: string;
  readonly liveChunks: readonly string[];
  readonly replayFrames: readonly PlaybackFrame[];
  readonly replayTimeMs: number;
  readonly writable: boolean;
  readonly highlight: TerminalHighlight | null;
  readonly onInput?: (data: string) => void;
}

interface OverlayMetrics {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly screenLeft: number;
  readonly screenTop: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly scale: number;
}

export function TerminalStage(props: TerminalStageProps) {
  const machineRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const inputRef = useRef(props.onInput);
  const fitRef = useRef<() => void>(() => undefined);
  const appliedRef = useRef({ identity: '', live: 0, replayCursor: 0, replayTime: 0, generation: 0 });
  const [scale, setScale] = useState(1);
  const [overlayMetrics, setOverlayMetrics] = useState<OverlayMetrics | null>(null);

  inputRef.current = props.onInput;

  useLayoutEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (host === null || surface === null) return;
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: props.writable,
      fontFamily: '"Berkeley Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.08,
      allowProposedApi: true,
      scrollback: 0,
      theme: {
        background: '#090d16',
        foreground: '#e8edf8',
        cursor: '#58e6b0',
        cursorAccent: '#090d16',
        selectionBackground: '#3f9fb855',
        black: '#111827',
        brightBlack: '#64748b',
        green: '#58e6b0',
        brightGreen: '#85f3ca',
        blue: '#67b7d1',
        brightBlue: '#9bd9e5',
        red: '#ff718b',
        brightRed: '#ff9bad',
        yellow: '#ffc861',
        brightYellow: '#ffda8a',
      },
    });
    const unicode = new Unicode11Addon();
    terminal.loadAddon(unicode);
    terminal.unicode.activeVersion = '11';
    terminal.open(surface);
    terminalRef.current = terminal;
    const input = terminal.onData((data) => inputRef.current?.(data));

    const fit = () => {
      const screen = surface.querySelector<HTMLElement>('.xterm-screen');
      if (screen === null) return;
      const naturalWidth = screen.offsetLeft + screen.clientWidth;
      const naturalHeight = screen.offsetTop + screen.clientHeight;
      if (naturalWidth <= 0 || naturalHeight <= 0) return;
      const availableWidth = host.clientWidth - 36;
      const availableHeight = host.clientHeight - 36;
      const next = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);
      if (!Number.isFinite(next) || next <= 0) return;
      surface.style.width = `${naturalWidth}px`;
      surface.style.height = `${naturalHeight}px`;
      surface.style.left = `${Math.max(18, (host.clientWidth - naturalWidth * next) / 2)}px`;
      surface.style.top = `${Math.max(18, (host.clientHeight - naturalHeight * next) / 2)}px`;
      surface.style.transform = `scale(${next})`;
      host.dataset['terminalScale'] = next.toFixed(4);
      setOverlayMetrics({
        left: Number.parseFloat(surface.style.left),
        top: Number.parseFloat(surface.style.top),
        width: naturalWidth,
        height: naturalHeight,
        screenLeft: screen.offsetLeft,
        screenTop: screen.offsetTop,
        screenWidth: screen.clientWidth,
        screenHeight: screen.clientHeight,
        scale: next,
      });
      setScale(next);
    };
    fitRef.current = fit;
    const observer = new ResizeObserver(() => requestAnimationFrame(fit));
    observer.observe(host);
    requestAnimationFrame(fit);
    return () => {
      observer.disconnect();
      input.dispose();
      unicode.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null) return;
    terminal.options.cursorBlink = props.writable;
    const applied = appliedRef.current;
    const reset = applied.identity !== props.identity;
    if (reset) {
      applied.identity = props.identity;
      applied.live = 0;
      applied.replayCursor = 0;
      applied.replayTime = 0;
      applied.generation += 1;
      const generation = applied.generation;
      terminal.write('', () => {
        if (generation !== appliedRef.current.generation) return;
        terminal.reset();
        terminal.clear();
        terminal.resize(Math.max(props.columns, 1), Math.max(props.rows, 1));
      });
    }
    if (props.mode === 'live') {
      if (props.liveChunks.length < applied.live) {
        terminal.reset();
        terminal.clear();
        applied.live = 0;
      }
      for (let index = applied.live; index < props.liveChunks.length; index += 1) {
        const chunk = props.liveChunks[index];
        if (chunk !== undefined) terminal.write(decode(chunk));
      }
      applied.live = props.liveChunks.length;
    } else if (props.mode === 'replay') {
      if (props.replayTimeMs < applied.replayTime) {
        applied.generation += 1;
        const generation = applied.generation;
        terminal.write('', () => {
          if (generation !== appliedRef.current.generation) return;
          terminal.reset();
          terminal.clear();
          terminal.resize(Math.max(props.columns, 1), Math.max(props.rows, 1));
        });
        applied.replayCursor = 0;
      }
      let cursor = applied.replayCursor;
      while (cursor < props.replayFrames.length) {
        const frame = props.replayFrames[cursor];
        if (frame === undefined || frame.t > props.replayTimeMs) break;
        applyFrame(terminal, frame);
        cursor += 1;
      }
      applied.replayCursor = cursor;
      applied.replayTime = props.replayTimeMs;
    }
    terminal.write('', () => requestAnimationFrame(() => fitRef.current()));
  }, [props.columns, props.identity, props.liveChunks, props.mode, props.replayFrames, props.replayTimeMs, props.rows, props.writable]);

  return (
    <section ref={machineRef} className="tw-terminal-machine" aria-label="Terminal screen">
      <header className="tw-machine-bar">
        <div className="tw-machine-identity">
          <span className="tw-machine-lights" aria-hidden="true"><i /><i /><i /></span>
          <strong>Terminal</strong>
          <span className="tw-evidence-pill" data-mode={props.mode}>
            {props.mode === 'live' ? <Radio aria-hidden="true" size={12} /> : <ScanLine aria-hidden="true" size={12} />}
            {props.mode === 'empty' ? 'NO SESSION' : props.mode.toUpperCase()}
          </span>
        </div>
        <div className="tw-machine-facts">
          <span>{props.columns} × {props.rows}</span>
          <span>{props.profile}</span>
          <button type="button" className="tw-fit-button" onClick={() => fitRef.current()}>
            Fit · {Math.round(scale * 100)}%
          </button>
        </div>
      </header>
      <div
        className="tw-terminal-viewport"
        ref={hostRef}
        data-terminal-columns={props.columns}
        data-terminal-rows={props.rows}
        data-terminal-identity={props.identity}
        tabIndex={props.writable ? 0 : -1}
        onFocus={(event) => {
          if (event.target === event.currentTarget) terminalRef.current?.focus();
        }}
      >
        <div className="tw-terminal-surface" ref={surfaceRef} />
        <TerminalHighlightOverlay highlight={props.highlight} metrics={overlayMetrics} columns={props.columns} rows={props.rows} />
        {props.mode === 'empty' ? (
          <div className="tw-terminal-empty">
            <ScanLine aria-hidden="true" />
            <span>Select an execution with a terminal session</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TerminalHighlightOverlay({ highlight, metrics, columns, rows }: {
  readonly highlight: TerminalHighlight | null;
  readonly metrics: OverlayMetrics | null;
  readonly columns: number;
  readonly rows: number;
}) {
  if (highlight === null) return null;
  if (highlight.bounds === undefined) {
    return <div className="tw-terminal-highlight-reason" role="status" data-pinned={highlight.pinned}>{highlight.reason ?? 'Target geometry is unavailable.'}</div>;
  }
  if (metrics === null) return null;
  const layerStyle = {
    left: metrics.left,
    top: metrics.top,
    width: metrics.width,
    height: metrics.height,
    transform: `scale(${metrics.scale})`,
  } as CSSProperties;
  const leftCell = Math.max(0, Math.min(columns, highlight.bounds.column));
  const topCell = Math.max(0, Math.min(rows, highlight.bounds.row));
  const rightCell = Math.max(leftCell, Math.min(columns, highlight.bounds.column + highlight.bounds.width));
  const bottomCell = Math.max(topCell, Math.min(rows, highlight.bounds.row + highlight.bounds.height));
  if (rightCell <= leftCell || bottomCell <= topCell) {
    return <div className="tw-terminal-highlight-reason" role="status" data-pinned={highlight.pinned}>Target bounds do not intersect the terminal grid.</div>;
  }
  const boxStyle = {
    left: metrics.screenLeft + leftCell / columns * metrics.screenWidth,
    top: metrics.screenTop + topCell / rows * metrics.screenHeight,
    width: (rightCell - leftCell) / columns * metrics.screenWidth,
    height: (bottomCell - topCell) / rows * metrics.screenHeight,
  } as CSSProperties;
  return <div className="tw-terminal-highlight-layer" style={layerStyle} data-testid="terminal-highlight-layer">
    <div className="tw-terminal-highlight" style={boxStyle} data-pinned={highlight.pinned} data-target-ref={highlight.targetRef ?? undefined}>
      <span>{[highlight.role, highlight.name, highlight.targetRef].filter(Boolean).join(' · ')}</span>
    </div>
  </div>;
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function applyFrame(terminal: Terminal, frame: PlaybackFrame): void {
  if (frame.kind === 'resize' && frame.columns !== undefined && frame.rows !== undefined) {
    terminal.resize(frame.columns, frame.rows);
  } else if (frame.kind === 'output' && frame.dataB64 !== undefined) {
    terminal.write(decode(frame.dataB64));
  }
}
