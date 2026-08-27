/**
 * The viewer, emitted as one HTML file.
 *
 * A report is not a second implementation of anything: it is the same bundle,
 * the same components and the same state, handed an {@link InlineDataSource}
 * instead of a socket. What differs is only where the data comes from, which is
 * exactly the distinction `data-source.ts` exists to hold.
 *
 * Everything is inlined — script, stylesheet, archive — so the file survives
 * being attached to a CI job, mailed, or opened from a disk with no network.
 * That is also what forces a budget: a page is a thing a browser must parse in
 * one go, and an unbounded recording would produce a file nobody can open.
 *
 * @packageDocumentation
 */

import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTrace } from '@termwright/trace';
import { INLINE_PAYLOAD_KEY, type InlinePayload, type ViewerState } from './data-source.js';
import { readTraceLogs } from './trace-logs.js';
import { readCommandLog, readFrames } from './trace-playback.js';
import { readProjectInfo } from './project.js';
import { readTraceOverview, traceStateAt } from './trace-source.js';

/** Payload ceiling, in bytes of JSON, before frames and logs are cut. */
const DEFAULT_BUDGET_BYTES = 8 * 1024 * 1024;

/** How many log records to read before the budget gets a say. */
const LOG_CEILING = 5_000;

/** Options for {@link writeInlineReport}. */
export interface InlineReportOptions {
  /**
   * Ceiling on the embedded archive, in bytes of JSON. Default 8 MiB. Frames
   * are cut from the end of the recording and logs from the oldest end; what
   * was cut is stated in the page rather than left for the reader to notice.
   */
  readonly budgetBytes?: number;
  /** Directory holding the built browser app. Default `dist/app`. */
  readonly appDir?: string;
  /** Project directory, for the name and branch shown in the frame. */
  readonly cwd?: string;
}

/** What an emission left out, so a caller can say so too. */
export interface InlineReportCut {
  /** Frames dropped from the end of the recording. */
  readonly frames: number;
  /** Log records dropped from the oldest end. */
  readonly logs: number;
}

/** Result of an emission. */
export interface InlineReportResult {
  readonly path: string;
  /** Size of the written file. */
  readonly bytes: number;
  readonly cut: InlineReportCut;
}

/**
 * Reads an archive into the payload a report carries.
 *
 * @param tracePath - `.twtrace` directory or zip.
 */
export async function buildInlinePayload(
  tracePath: string,
  options: InlineReportOptions = {},
): Promise<{ readonly payload: InlinePayload; readonly cut: InlineReportCut }> {
  const budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const reader = await openTrace(tracePath);
  try {
    const overview = await readTraceOverview(reader);
    const traceState = await traceStateAt(reader, 0);
    const commands = await readCommandLog(reader);
    const frames = await readFrames(reader);
    const logs = await readTraceLogs(reader, { after: 0, limit: LOG_CEILING });

    const state: ViewerState = {
      mode: 'post-mortem',
      // The frame states what was true when the report was written; a reader
      // opening it next month is not looking at their own checkout.
      project: await readProjectInfo(options.cwd ?? process.cwd()),
      // A report has no attached session: the recording is the session, and the
      // pane builds its terminal from the archive's own profile.
      sessions: [],
      trace: overview,
      record: null,
    };

    const fixed = size({
      v: 1,
      state,
      commands,
      traceState,
      logs: { ...logs, records: [] },
      frames: { ...frames, frames: [] },
    });
    const trimmedFrames = trimFrames(frames.frames, Math.max(budget - fixed, 0));
    const remaining = Math.max(budget - fixed - size(trimmedFrames.kept), 0);
    const trimmedLogs = trimLogs(logs.records, remaining);

    return {
      payload: {
        v: 1,
        state,
        commands,
        traceState,
        frames: {
          ...frames,
          frames: trimmedFrames.kept,
          truncated: frames.truncated || trimmedFrames.dropped > 0,
        },
        logs: {
          ...logs,
          records: trimmedLogs.kept,
          truncated: logs.truncated || trimmedLogs.dropped > 0,
          // Nothing older can be fetched from a file: offering to load more
          // would be a button that cannot work.
          hasMoreBefore: false,
          hasMoreAfter: false,
        },
      },
      cut: { frames: trimmedFrames.dropped, logs: trimmedLogs.dropped },
    };
  } finally {
    await reader.close();
  }
}

/**
 * Writes the viewer and an archive as one self-contained HTML file.
 *
 * @param tracePath - `.twtrace` directory or zip.
 * @param outFile - where to write the report.
 * @throws Error when the browser bundle has not been built.
 */
export async function writeInlineReport(
  tracePath: string,
  outFile: string,
  options: InlineReportOptions = {},
): Promise<InlineReportResult> {
  const { payload, cut } = await buildInlinePayload(tracePath, options);
  const html = await renderInlineHtml(payload, options.appDir);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html, 'utf8');
  return { path: outFile, bytes: Buffer.byteLength(html, 'utf8'), cut };
}

/**
 * Builds the page: the built shell with its script, stylesheet and the payload
 * inlined.
 *
 * @throws Error when `appDir` holds no built app.
 */
export async function renderInlineHtml(payload: InlinePayload, appDir?: string): Promise<string> {
  const directory = appDir ?? fileURLToPath(new URL('../dist/app/', import.meta.url));
  let shell: string;
  try {
    shell = await readFile(join(directory, 'index.html'), 'utf8');
  } catch {
    throw new Error(
      `${directory} holds no built app; run \`pnpm --filter @termwright/ui build\` first`,
    );
  }

  const script = await inlineAsset(
    directory,
    shell,
    /<script[^>]*src="([^"]+)"[^>]*><\/script>/,
    'script',
  );
  const styled = await inlineAsset(
    directory,
    script,
    /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*\/?>/,
    'style',
  );
  const selfContained = await inlineReferencedSvgAssets(directory, styled);

  const data = `<script>globalThis.${INLINE_PAYLOAD_KEY}=${jsonForScript(payload)};</script>`;
  // Function form throughout this file: `$&`, `$'` and friends are replacement
  // patterns, and a JS bundle is full of them. Passing the text directly
  // rewrites it into garbage that parses as HTML but not as a program.
  return selfContained.replace('</head>', () => `${data}</head>`);
}

/** Embeds emitted SVGs only in the standalone artifact. Normal Vite output keeps real files. */
async function inlineReferencedSvgAssets(directory: string, html: string): Promise<string> {
  let result = html;
  const assetDirectory = join(directory, 'assets');
  const names = (await readdir(assetDirectory)).filter((name) => name.endsWith('.svg'));
  for (const name of names) {
    const content = await readFile(join(assetDirectory, name));
    const dataUrl = `data:image/svg+xml;base64,${content.toString('base64')}`;
    // Vite uses `./assets/name.svg` in HTML but a bare sibling name beside a
    // JS chunk. Once the chunk is inlined, both must point at the same data URL.
    for (const reference of [`./assets/${name}`, `/assets/${name}`, `assets/${name}`, name]) {
      result = result.replaceAll(reference, dataUrl);
    }
  }
  return result;
}

/** Replaces a `src`/`href` reference with the file's contents. */
async function inlineAsset(
  directory: string,
  html: string,
  pattern: RegExp,
  tag: 'script' | 'style',
): Promise<string> {
  const match = pattern.exec(html);
  if (match === null) return html;
  const href = match[1];
  if (href === undefined) return html;
  const content = await readFile(join(directory, href.replace(/^\.?\//, '')), 'utf8');
  const attributes = tag === 'script' ? ' type="module"' : '';
  // `</script>` inside the bundle would close the tag early; the sequence
  // cannot appear in valid JS other than inside a string, so escaping it is
  // safe and keeps the file one document.
  const body = tag === 'script' ? content.replaceAll('</script>', '<\\/script>') : content;
  return html.replace(match[0], () => `<${tag}${attributes}>${body}</${tag}>`);
}

/**
 * JSON safe to sit inside a `<script>` element.
 *
 * `</script>` and the HTML comment openers end a script block wherever they
 * appear, including inside a string literal — a log line containing one would
 * otherwise truncate the page.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function size(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

/**
 * Keeps as much of the recording as fits, measured from its start.
 *
 * Frames rebuild the screen by replaying in order, so the only cut that leaves
 * a working replay is one at the end: dropping a frame from the middle would
 * put every later frame on a screen that never existed.
 */
function trimFrames<T>(
  frames: readonly T[],
  budget: number,
): { kept: readonly T[]; dropped: number } {
  if (size(frames) <= budget) return { kept: frames, dropped: 0 };
  let used = 2; // the brackets
  const kept: T[] = [];
  for (const frame of frames) {
    const cost = size(frame) + 1;
    if (used + cost > budget) break;
    used += cost;
    kept.push(frame);
  }
  return { kept, dropped: frames.length - kept.length };
}

/**
 * Keeps the newest records that fit.
 *
 * The opposite end from frames, deliberately: a report is usually opened to
 * find out how something ended, and the lines just before that are the ones
 * worth carrying.
 */
function trimLogs<T>(
  records: readonly T[],
  budget: number,
): { kept: readonly T[]; dropped: number } {
  if (size(records) <= budget) return { kept: records, dropped: 0 };
  let used = 2;
  const kept: T[] = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index] as T;
    const cost = size(record) + 1;
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(record);
  }
  return { kept, dropped: records.length - kept.length };
}
