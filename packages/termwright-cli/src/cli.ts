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
  buildUsage,
  exitCodeFor,
  runCli as runMcpCli,
  toErrorPayload,
  writeAgentSkill,
  EXIT_CODES,
  type CliIo,
} from '@termwright/mcp';
import { startUiServer } from '@termwright/ui';
import { parseArgs, type ParsedArgs } from './args.js';
import {
  runUi,
  startVitest,
  waitForInterrupt,
  type UiRuntime,
  type UiResult,
} from './ui-command.js';
import { CLI_NAME, CLI_VERSION } from './version.js';

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
}

/** The real collaborators. */
export function defaultDeps(io: CliIo = defaultIo): CliDeps {
  return {
    io,
    ui: { startUi: startUiServer, startVitest, waitForInterrupt },
    runMcp: runMcpCli,
    cwd: process.cwd(),
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
        io.out(json ? JSON.stringify(buildAgentContext()) : helpText());
        return EXIT_CODES.ok;

      case 'usage':
        io.out(json ? JSON.stringify(buildAgentContext()) : buildUsage());
        return EXIT_CODES.ok;

      case 'agent-context':
        io.out(JSON.stringify(buildAgentContext(), null, json ? 0 : 2));
        return EXIT_CODES.ok;

      case 'skill':
        return await emitSkill(args, io);

      case 'mcp':
        // Forwarded verbatim, `--json` included, so the delegate owns its own
        // flags and its own error rendering.
        return await deps.runMcp(json ? [...args.rest, '--json'] : args.rest, io);

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

async function launchUi(args: ParsedArgs, deps: CliDeps, json: boolean): Promise<number> {
  const announce = (ready: Omit<UiResult, 'runnerExitCode'>): void => {
    if (json) {
      deps.io.out(JSON.stringify({ url: ready.url, port: ready.port, mode: ready.mode }));
      return;
    }
    deps.io.out(`termwright ui (${ready.mode}) — ${ready.url}`);
  };

  const result = await runUi(
    {
      trace: args.trace,
      record: args.record ? args.rest : undefined,
      outFile: args.outFile,
      port: args.port,
      host: args.host,
      watch: args.watch,
      // In record mode `rest` is the recorded command, not runner arguments.
      rest: args.record ? [] : args.rest,
      cwd: deps.cwd,
    },
    deps.ui,
    announce,
  );

  // The runner's own failures are assertion failures, not CLI faults.
  return result.runnerExitCode === undefined || result.runnerExitCode === 0
    ? EXIT_CODES.ok
    : EXIT_CODES.assertion;
}

function helpText(): string {
  return [
    `${CLI_NAME} ${CLI_VERSION} — testing terminal programs by role and name`,
    '',
    'Usage:',
    `  ${CLI_NAME} ui [--trace <file>] [--port N] [--host H] [--no-watch] [-- <vitest args>]`,
    `  ${CLI_NAME} ui --record [--out-file <file>] -- <command>`,
    `  ${CLI_NAME} codegen [--out-file <file>] -- <command>`,
    `  ${CLI_NAME} mcp [--http] [--port N]`,
    `  ${CLI_NAME} agent-context | usage | skill [--out <dir>]`,
    '',
    'Commands:',
    '  ui              open the runner: live terminal, semantic inspector, timeline.',
    '                  With no flags it starts Vitest in watch mode and points it at',
    '                  the runner; --trace opens a .twtrace archive instead, and',
    '                  --record drives a program you name and writes the test.',
    '  codegen         `ui --record`, for when recording is the whole point.',
    '  mcp             serve the MCP tools; every argument is forwarded to',
    '                  @termwright/mcp untouched.',
    '  agent-context   versioned JSON describing every tool, parameter and exit code.',
    '  usage           the one-screen cheat sheet.',
    '  skill           an agent-skill package (SKILL.md + reference + context).',
    '',
    'Global:',
    '  --json          machine-readable output; errors carry `kind`.',
    '  --version, -v   print the version.',
    '  --help, -h      print this.',
    '',
    'Exit codes: 0 ok, 1 assertion, 2 usage, 3 no-session, 4 ipc, 5 internal.',
  ].join('\n');
}

/** Entry point for the `termwright` bin. */
export async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2));
}
