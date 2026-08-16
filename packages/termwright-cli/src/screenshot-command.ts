/**
 * `termwright screenshot` — one moment of a recording, as a PNG.
 *
 * The renderer already exists in `@termwright/screenshot` and the
 * reconstruction in `@termwright/trace`; what was missing was a way to reach
 * them without writing a script. This file is only the path between them: resolve
 * a moment, replay the cast prefix into cells, rasterise.
 *
 * @packageDocumentation
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { frameFromAnsi, openTrace, type TraceReader } from '@termwright/trace';
import { renderPng } from '@termwright/screenshot';

/** How the moment to capture was named. */
export interface ScreenshotRequest {
  /** `.twtrace` directory or zip. */
  readonly trace: string;
  /** Cast-timeline offset in milliseconds. */
  readonly atMs?: number | undefined;
  /** Step index, as `trace.overview` numbers them from 1. */
  readonly step?: number | undefined;
  /** Where to write the PNG. Default: the archive's name with a `.png` suffix. */
  readonly out?: string | undefined;
  /** Pixel density multiplier. Default 1. */
  readonly scale?: number | undefined;
}

/** What the capture produced, for the caller to render. */
export interface ScreenshotResult {
  readonly path: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  /**
   * The moment captured, on the cast timeline.
   *
   * This is the moment *reconstructed*, not the one asked for: a recording has
   * output at particular times, and `stateAt` rebuilds the screen as of the
   * last event at or before the request. Reporting the request back would claim
   * the picture shows a moment nothing was recorded at.
   */
  readonly timeMs: number;
  /** How that moment was chosen, for a line the user can check. */
  readonly chosen: 'the moment given' | 'the step given' | 'the crash' | 'the last step' | 'the end';
  /**
   * Characters no embedded glyph covered. They rasterise blank, so a caller
   * that stays silent about them ships a screenshot with holes in it.
   */
  readonly fallbackCharacters: readonly string[];
  /**
   * Whether this render waited for the system font scan — a second on macOS
   * and several on Windows, with no cache between calls. Reported so a slow
   * capture has a stated reason rather than looking like the archive was big.
   */
  readonly systemFontsLoaded: boolean;
}

/**
 * Writes one frame of a recording as a PNG.
 *
 * @throws Error when the archive cannot be read, or the moment named is not in
 * it. Naming a step that does not exist is a mistake worth stopping on: the
 * nearest step would produce a picture of something else entirely.
 */
export async function captureScreenshot(request: ScreenshotRequest): Promise<ScreenshotResult> {
  // Checked before the archive is opened: a contradictory command line is
  // wrong whether or not the file exists, and saying so without reading a
  // recording keeps the two kinds of mistake apart.
  checkRequest(request);

  const reader = await openTrace(request.trace);
  try {
    const moment = await resolveMoment(reader, request);
    const state = await reader.stateAt(moment.timeMs);
    const grid = await frameFromAnsi(state.castPrefix, {
      columns: state.columns,
      rows: state.rows,
      timeMs: state.timeMs,
      semanticRevision: state.nearestSemanticRevision,
    });

    const rendered = renderPng(grid, { scale: request.scale ?? 1 });

    const path = request.out ?? defaultOutPath(request.trace);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rendered.png);

    return {
      path,
      bytes: rendered.png.byteLength,
      width: rendered.width,
      height: rendered.height,
      timeMs: state.timeMs,
      chosen: moment.chosen,
      fallbackCharacters: rendered.fallbackCharacters,
      systemFontsLoaded: rendered.systemFontsLoaded,
    };
  } finally {
    await reader.close();
  }
}

/**
 * Picks the moment to capture.
 *
 * With nothing given, the default is the moment worth looking at rather than
 * the last byte of the recording: a program that left the alternate screen
 * ends on a blank one, and a screenshot of nothing helps nobody. A crash wins,
 * then the end of the last step, then the end of the recording — and which of
 * those it was is reported, so the picture is never a mystery.
 */
async function resolveMoment(
  reader: TraceReader,
  request: ScreenshotRequest,
): Promise<{ readonly timeMs: number; readonly chosen: ScreenshotResult['chosen'] }> {
  if (request.atMs !== undefined) return { timeMs: request.atMs, chosen: 'the moment given' };

  const steps = await readSteps(reader);
  if (request.step !== undefined) {
    const step = steps[request.step - 1];
    if (step === undefined) {
      throw new Error(
        `--step ${request.step} is not in this recording; it has ${steps.length} step${steps.length === 1 ? '' : 's'}`,
      );
    }
    return { timeMs: step.castEndOffset, chosen: 'the step given' };
  }

  const crash = reader.meta.crash;
  if (crash !== undefined) return { timeMs: crash.castOffset, chosen: 'the crash' };
  const last = steps.at(-1);
  if (last !== undefined) return { timeMs: last.castEndOffset, chosen: 'the last step' };
  return { timeMs: reader.meta.durationMs ?? 0, chosen: 'the end' };
}

/**
 * Rejects a request that is wrong on its own terms.
 *
 * @throws Error naming the flag at fault.
 */
export function checkRequest(request: ScreenshotRequest): void {
  if (request.atMs !== undefined && request.step !== undefined) {
    throw new Error('--at and --step name the same moment two ways; pass one');
  }
  if (request.atMs !== undefined && (!Number.isFinite(request.atMs) || request.atMs < 0)) {
    throw new Error(`--at must be a time in milliseconds, got ${String(request.atMs)}`);
  }
  if (request.step !== undefined && (!Number.isInteger(request.step) || request.step < 1)) {
    // Steps are numbered as `trace.overview` shows them, from 1: a `--step 0`
    // is a misreading of that list rather than a request for the first step.
    throw new Error(`--step must be a step number from 1, got ${String(request.step)}`);
  }
  if (request.scale !== undefined && (!Number.isFinite(request.scale) || request.scale <= 0)) {
    throw new Error(`--scale must be a positive number, got ${String(request.scale)}`);
  }
}

/** Step boundaries, in the order the recording holds them. */
async function readSteps(
  reader: TraceReader,
): Promise<readonly { readonly title: string; readonly castEndOffset: number }[]> {
  const steps: { title: string; castEndOffset: number }[] = [];
  const open = new Map<string, string>();
  try {
    for await (const event of reader.events()) {
      if (event.kind === 'step-start') open.set(event.stepId, event.title);
      if (event.kind === 'step-end') {
        const title = open.get(event.stepId);
        if (title !== undefined) steps.push({ title, castEndOffset: event.castOffset });
      }
    }
  } catch {
    // A truncated event log costs the steps after the break, not the picture:
    // an explicit `--at` never reads this at all.
  }
  return steps;
}

/** `out/login.twtrace` → `login.png`, next to where the command runs. */
function defaultOutPath(trace: string): string {
  const name = basename(trace, extname(trace));
  return join('.', `${name === '' ? 'screenshot' : name}.png`);
}
