/**
 * The `termwright` binary.
 *
 * It is a dispatcher and nothing more. The runner belongs to
 * `@termwright/ui`, and the agent-facing surface — `agent-context`, `usage`,
 * `skill`, the MCP server itself — belongs to `@termwright/mcp`, which this
 * file *imports* rather than spawns. That is what keeps the two binaries from
 * drifting: there is one implementation of `agent-context`, one exit-code
 * taxonomy, and one JSON error shape, and this package owns none of them.
 *
 * Exit codes follow CONTRACTS.md §MCP: 0 ok / 1 assertion / 2 usage /
 * 3 no-session / 4 ipc / 5 internal.
 */

import {
  buildAgentContext,
  buildAgentSkill,
  exitCodeFor,
  runCli as runMcpCli,
  toErrorPayload,
  usageError,
  writeAgentSkill,
  EXIT_CODES,
  type CliIo,
} from '@termwright/mcp';
import { launchDesktopHost, type DesktopHostHandle } from '@termwright/desktop-host';
import { stat } from 'node:fs/promises';
import { openInBrowser, shouldOpenBrowser, startUiServer, writeInlineReport } from '@termwright/ui';
import { captureScreenshot } from './screenshot-command.js';
import { documentedCommands, parseArgs, type ParsedArgs } from './args.js';
import {
  runUi,
  startVitest,
  waitForInterrupt,
  type UiRuntime,
  type UiResult,
} from './ui-command.js';
import { CLI_NAME, CLI_VERSION } from './version.js';
import { formatDoctor, runDoctor, type DoctorReport } from './doctor.js';

export type { CliIo };

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

/** The collaborators the CLI reaches for, injectable so tests spawn nothing. */
export interface CliDeps {
  readonly io: CliIo;
  readonly ui: UiRuntime;
  /** The MCP CLI, imported rather than spawned. */
  readonly runMcp: (argv: readonly string[], io: CliIo) => Promise<number>;
  readonly cwd: string;
  /** Desktop companion launcher, injectable so CLI tests require no display. */
  readonly launchDesktop: (url: string) => Promise<DesktopHostHandle>;
  /** System browser opener, injectable so CLI tests open nothing. */
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly processContext: {
    readonly isTty: boolean;
    readonly env: Readonly<Record<string, string | undefined>>;
  };
  readonly doctor: (cwd: string) => Promise<DoctorReport>;
}

/** The real collaborators. */
export function defaultDeps(io: CliIo = defaultIo): CliDeps {
  return {
    io,
    ui: { startUi: startUiServer, startVitest, waitForInterrupt },
    runMcp: runMcpCli,
    cwd: process.cwd(),
    launchDesktop: (url) => launchDesktopHost({ url }),
    openBrowser: openInBrowser,
    processContext: { isTty: process.stdout.isTTY === true, env: process.env },
    doctor: runDoctor,
  };
}

/**
 * Run the CLI and resolve with the process exit code.
 *
 * `ui` blocks for as long as the runner is up, so it only resolves when the
 * test run finishes or the user interrupts.
 *
 * @example
 * ```ts
 * process.exitCode = await runCli(process.argv.slice(2));
 * ```
 */
export async function runCli(
  argv: readonly string[],
  deps: CliDeps = defaultDeps(),
): Promise<number> {
  const { io } = deps;
  // Read before parsing: a failure on a later argument must still honour --json.
  let json = argv.includes('--json');

  try {
    const args = parseArgs(argv);
    json = args.json;

    switch (args.command) {
      case 'version':
        io.out(json ? JSON.stringify({ name: CLI_NAME, version: CLI_VERSION }) : CLI_VERSION);
        return EXIT_CODES.ok;

      case 'help':
        io.out(json ? JSON.stringify(usageDocument()) : helpText());
        return EXIT_CODES.ok;

      case 'usage':
        io.out(json ? JSON.stringify(usageDocument()) : usageText());
        return EXIT_CODES.ok;

      case 'agent-context':
        io.out(JSON.stringify(buildAgentContext(), null, json ? 0 : 2));
        return EXIT_CODES.ok;

      case 'skill':
        return await emitSkill(args, io);

      case 'doctor': {
        const report = await deps.doctor(deps.cwd);
        io.out(json ? JSON.stringify(report) : formatDoctor(report));
        return report.ok ? EXIT_CODES.ok : EXIT_CODES.assertion;
      }

      case 'mcp':
        // Forwarded verbatim, `--json` included, so the delegate owns its own
        // flags and its own error rendering.
        return await deps.runMcp(json ? [...args.rest, '--json'] : args.rest, io);

      case 'report':
        return await emitReport(args, deps, json);

      case 'screenshot':
        return await emitScreenshot(args, deps, json);

      case 'ui':
      case 'codegen':
        return await launchUi(args, deps, json);
    }
  } catch (error) {
    const payload = toErrorPayload(error);
    io.err(json ? JSON.stringify(payload) : `${payload.kind}: ${payload.message}`);
    if (!json && payload.suggestion !== undefined) io.err(`suggestion: ${payload.suggestion}`);
    return exitCodeFor(payload.kind);
  }
}

async function emitSkill(args: ParsedArgs, io: CliIo): Promise<number> {
  if (args.out === undefined) {
    const files = buildAgentSkill();
    io.out(
      args.json
        ? JSON.stringify(Object.fromEntries(files.map((file) => [file.path, file.contents])))
        : files.map((file) => `=== ${file.path}\n${file.contents}`).join('\n'),
    );
    return EXIT_CODES.ok;
  }
  const written = await writeAgentSkill(args.out);
  io.out(args.json ? JSON.stringify({ written }) : written.join('\n'));
  return EXIT_CODES.ok;
}

/**
 * Reclassifies a failure to open an archive the user named.
 *
 * A path the user typed is *input*: a typo in it is a usage error (exit 2), not
 * an internal fault (exit 5). The trace reader reports a missing archive as a
 * protocol violation and the filesystem reports one as `ENOENT`, and both land
 * in the catch-all otherwise — which quietly tells an agent or a CI job that
 * termwright broke when in fact the path was wrong.
 *
 * Only errors carrying a string `code` are reclassified: `TraceError` and
 * Node's filesystem errors both do, while a genuine bug in our own code (a
 * `TypeError`, say) does not, and must keep reading as internal.
 */
async function asArchiveUsageError(error: unknown, path: string): Promise<unknown> {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return error;
  const detail = error instanceof Error ? error.message : String(error);
  return usageError(`cannot read the archive ${path}: ${detail}`, await suggestionFor(code, path));
}

/** Codes that name a missing archive outright. */
const MISSING_CODES = new Set(['not-found', 'ENOENT', 'ENOTDIR', 'EACCES']);

/**
 * What to try next, which depends on which mistake this was.
 *
 * A wrong path and a broken archive are both the user's input — exit 2 either
 * way — but they call for opposite actions. Telling someone to check the path
 * when the path was right and the file is truncated sends them looking in the
 * wrong place, and a corrupt artifact off a CI job is exactly the case where
 * that costs the most time.
 *
 * The question "is it there?" is answered by asking the filesystem rather than
 * by reading the error, because today `openTrace` reports a missing archive as
 * a protocol violation — a mis-coding its owner is fixing with a `not-found`
 * code. Looking ourselves is right before that lands and stays right after.
 */
async function suggestionFor(code: string, path: string): Promise<string> {
  const present = MISSING_CODES.has(code) ? false : await exists(path);
  return present
    ? 'the file is there but does not read as an archive — it may be truncated, ' +
        'or written by a version this build does not know'
    : 'check the path, or pass the directory or .zip a run wrote';
}

/** Whether anything at all is at `path`. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `termwright screenshot` — one moment of a recording, as a PNG.
 *
 * The moment chosen is printed, not just the file written: with no `--at` or
 * `--step` the command picks one, and a picture whose subject is a mystery is
 * hard to argue with.
 */
async function emitScreenshot(args: ParsedArgs, deps: CliDeps, json: boolean): Promise<number> {
  const trace = args.trace as string; // `parseArgs` rejects `screenshot` without one
  let result: Awaited<ReturnType<typeof captureScreenshot>>;
  try {
    result = await captureScreenshot({
      trace,
      atMs: args.atMs,
      step: args.step,
      out: args.outFile,
      scale: args.scale,
    });
  } catch (error) {
    throw await asArchiveUsageError(error, trace);
  }

  if (json) {
    deps.io.out(
      JSON.stringify({
        path: result.path,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        timeMs: result.timeMs,
        chosen: result.chosen,
        systemFontsLoaded: result.systemFontsLoaded,
        ...(result.fallbackCharacters.length === 0
          ? {}
          : { fallbackCharacters: [...result.fallbackCharacters] }),
      }),
    );
    return EXIT_CODES.ok;
  }

  deps.io.out(`wrote ${result.path} (${result.width}×${result.height}, ${result.chosen} at ${result.timeMs}ms)`);
  if (result.fallbackCharacters.length > 0) {
    // Not "these are blank" — with the font fallback on, which is how this
    // command renders, the rasteriser draws them from the fonts installed
    // here. The fact worth stating is that the image is machine-dependent:
    // the same archive can produce a different PNG on a CI runner. The scan
    // that finds those fonts is also what makes such a capture slow.
    const characters = result.fallbackCharacters.join(' ');
    deps.io.err(
      `  ${result.fallbackCharacters.length} character(s) had no embedded glyph (${characters}); ` +
        'the rasteriser drew them with this machine\'s fonts, so another machine may render them ' +
        'differently — and finding those fonts is what made this capture slow',
    );
  }
  return EXIT_CODES.ok;
}

/**
 * `termwright report` — the viewer and one archive, written as a single file.
 *
 * The same page `ui --trace` shows, with its data baked in: it opens over
 * `file://`, which is what makes it usable as a CI artifact.
 */
async function emitReport(args: ParsedArgs, deps: CliDeps, json: boolean): Promise<number> {
  const trace = args.trace as string; // `parseArgs` rejects `report` without one
  const out = args.outFile ?? 'termwright-report.html';
  let result: Awaited<ReturnType<typeof writeInlineReport>>;
  try {
    result = await writeInlineReport(trace, out);
  } catch (error) {
    throw await asArchiveUsageError(error, trace);
  }

  if (json) {
    deps.io.out(JSON.stringify({ path: result.path, bytes: result.bytes, cut: result.cut }));
    return EXIT_CODES.ok;
  }
  const size = `${Math.round(result.bytes / 1024)} KiB`;
  deps.io.out(`wrote ${result.path} (${size})`);
  // Say what the file does not contain. A report that quietly ends early is
  // indistinguishable from a program that ended early.
  if (result.cut.frames > 0) {
    deps.io.out(`  the recording is cut: ${result.cut.frames} frames left out to fit the budget`);
  }
  if (result.cut.logs > 0) {
    deps.io.out(`  the log is cut: the ${result.cut.logs} oldest records left out to fit the budget`);
  }
  return EXIT_CODES.ok;
}

async function launchUi(args: ParsedArgs, deps: CliDeps, json: boolean): Promise<number> {
  const announce = async (ready: Omit<UiResult, 'runnerExitCode'>): Promise<DesktopHostHandle | undefined> => {
    if (json) {
      deps.io.out(JSON.stringify({ url: ready.url, port: ready.port, mode: ready.mode }));
      return undefined;
    }
    deps.io.out(`termwright ui (${ready.mode}) — ${ready.url}`);
    const interactive = shouldOpenBrowser({
      requested: args.surface !== 'none',
      json,
      isTty: deps.processContext.isTty,
      env: deps.processContext.env,
    });
    if (!interactive) return undefined;

    if (args.surface === 'browser') {
      const opened = await deps.openBrowser(ready.url);
      if (!opened) deps.io.err('could not open a browser; the URL above is the way in');
      return undefined;
    }

    const hostname = new URL(ready.url).hostname;
    if (hostname !== '127.0.0.1' && hostname !== '[::1]') {
      deps.io.err('the desktop runner only accepts loopback URLs; use --browser or open the URL above');
      return undefined;
    }
    try {
      return await deps.launchDesktop(ready.url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.io.err(`could not open the desktop runner (${detail}); falling back to the browser`);
      const opened = await deps.openBrowser(ready.url);
      if (!opened) deps.io.err('could not open a browser; the URL above is the way in');
      return undefined;
    }
  };

  const result = await launch(args, deps, announce);

  // The runner's own failures are assertion failures, not CLI faults.
  return result.runnerExitCode === undefined || result.runnerExitCode === 0
    ? EXIT_CODES.ok
    : EXIT_CODES.assertion;
}

/**
 * Starts the runner, reclassifying a bad `--trace` path as a usage error.
 *
 * Only the archive can fail this way: in replay mode `runUi` opens the file and
 * then waits, so an error carrying a code is about the file the user named.
 */
async function launch(
  args: ParsedArgs,
  deps: CliDeps,
  announce: (ready: Omit<UiResult, 'runnerExitCode'>) => void | DesktopHostHandle | Promise<void | DesktopHostHandle>,
): Promise<UiResult> {
  const request = {
    trace: args.trace,
    record: args.record ? args.rest : undefined,
    outFile: args.outFile,
    port: args.port,
    host: args.host,
    tags: args.tags,
    watch: args.watch,
    // In record mode `rest` is the recorded command, not runner arguments.
    rest: args.record ? [] : args.rest,
    cwd: deps.cwd,
  };
  if (args.trace === undefined) return runUi(request, deps.ui, announce);
  try {
    return await runUi(request, deps.ui, announce);
  } catch (error) {
    throw await asArchiveUsageError(error, args.trace);
  }
}

const NAME_COLUMN = 16;

/** Indents continuation lines under a command's first summary line. */
function summaryBlock(name: string, summary: readonly string[]): readonly string[] {
  const [first, ...rest] = summary;
  return [
    `  ${name.padEnd(NAME_COLUMN - 2)}${first ?? ''}`,
    ...rest.map((line) => `${' '.repeat(NAME_COLUMN)}${line}`),
  ];
}

/**
 * The full help, rendered from {@link CLI_COMMANDS}.
 *
 * Both this and {@link usageText} read the same table, so a command cannot be
 * documented in one and missing from the other.
 */
function helpText(): string {
  const commands = documentedCommands();
  return [
    `${CLI_NAME} ${CLI_VERSION} — testing terminal programs by role and name`,
    '',
    'Usage:',
    ...commands.flatMap(([, doc]) => doc.synopsis.map((line) => `  ${CLI_NAME} ${line}`)),
    '',
    'Commands:',
    ...commands.flatMap(([name, doc]) => summaryBlock(name, doc.summary)),
    '',
    'Global:',
    '  --json          machine-readable output; errors carry `kind`.',
    '  --version, -v   print the version.',
    '  --help, -h      print this.',
    '',
    'Exit codes: 0 ok, 1 assertion, 2 usage, 3 no-session, 4 ipc, 5 internal.',
  ].join('\n');
}

/**
 * The one-screen cheat sheet for **this** CLI.
 *
 * It used to print `@termwright/mcp`'s cheat sheet, which described the MCP
 * server and never mentioned `ui`, `report` or `codegen`. That sheet is still
 * one command away — `termwright mcp usage` — where it belongs.
 */
function usageText(): string {
  return [
    `${CLI_NAME} ${CLI_VERSION} — testing terminal programs by role and name`,
    '',
    ...documentedCommands().map(([name, doc]) => `  ${name.padEnd(NAME_COLUMN - 2)}${doc.headline}`),
    '',
    `  ${CLI_NAME} mcp usage`.padEnd(NAME_COLUMN + 14) + 'the MCP tool cheat sheet, for agents.',
    `  ${CLI_NAME} --help`.padEnd(NAME_COLUMN + 14) + 'the same list with every flag.',
    '',
    'Exit codes: 0 ok, 1 assertion, 2 usage, 3 no-session, 4 ipc, 5 internal.',
  ].join('\n');
}

/** The machine-readable form of {@link usageText}. */
function usageDocument(): Record<string, unknown> {
  return {
    v: 1,
    name: CLI_NAME,
    version: CLI_VERSION,
    commands: documentedCommands().map(([name, doc]) => ({
      name,
      synopsis: [...doc.synopsis],
      headline: doc.headline,
      summary: doc.summary.join(' '),
    })),
    exitCodes: { ...EXIT_CODES },
  };
}

/** Entry point for the `termwright` bin. */
export async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2));
}
