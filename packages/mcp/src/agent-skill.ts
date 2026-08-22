/**
 * `skill` — emits an agent-skill package: the distribution channel into Claude
 * Code and other hosts that load skills from a directory.
 *
 * The package is generated from the same zod schemas as `agent-context`, so a
 * tool that changes its arguments changes the skill in the same commit. It is
 * three files: `SKILL.md` (what an agent reads), `agent-context.json` (the
 * machine-readable surface) and `reference.md` (the per-tool parameter list the
 * skill body links to).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAgentContext, buildUsage } from './agent-context.js';
import type { JsonSchema } from './agent-context.js';
import { TOOLS } from './registry.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

/** One file of the emitted package, keyed by its path inside the directory. */
export interface SkillFile {
  readonly path: string;
  readonly contents: string;
}

/** Frontmatter description; hosts match on this when deciding to load a skill. */
const SKILL_DESCRIPTION =
  'Drive terminal programs (TUIs, CLIs, REPLs) over MCP: launch one in a real pseudo-terminal, ' +
  'read a compact accessibility-style snapshot, click and type, wait on conditions, and poll only ' +
  'what changed. Use when asked to test, inspect, automate or debug a terminal application.';

function renderParameters(schema: JsonSchema): string {
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null) return '  (no parameters)';
  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
  return Object.entries(properties as Record<string, Record<string, unknown>>)
    .map(([name, definition]) => {
      const type =
        typeof definition['type'] === 'string'
          ? definition['type']
          : Array.isArray(definition['enum'])
            ? (definition['enum'] as unknown[]).map((value) => JSON.stringify(value)).join('|')
            : 'value';
      const description =
        typeof definition['description'] === 'string' ? ` — ${definition['description']}` : '';
      return `- \`${name}\`${required.has(name) ? '' : '?'}: ${type}${description}`;
    })
    .join('\n');
}

/** The skill body an agent reads before its first tool call. */
function renderSkillMarkdown(): string {
  return [
    '---',
    `name: ${SERVER_NAME}`,
    `description: ${SKILL_DESCRIPTION}`,
    '---',
    '',
    `# Driving terminal programs with ${SERVER_NAME}`,
    '',
    'The MCP server exposes one terminal per handle (`t1`, `t2`, …). Every action goes through a',
    'real pseudo-terminal: a click is a mouse report, a keystroke is real bytes. There is no',
    'back-channel into the application.',
    '',
    '## The loop',
    '',
    '1. `terminal.launch { command: ["node", "app.js"] }` — returns the handle and the first snapshot.',
    '2. `terminal.snapshot { terminal }` — compact refs, visible text, cursor, modes, scroll position.',
    '3. Act: `terminal.click`, `terminal.press`, `terminal.type`, `terminal.paste`, `terminal.drag`, …',
    '4. `terminal.wait_for { wait: "text" | "visible" | "stable" | "idle" | "exit", … }` — never sleep.',
    '5. `terminal.capture_since { cursor }` — only the rows and semantic subtrees that changed.',
    '6. `terminal.close { terminal }`.',
    '',
    '## Reading a snapshot',
    '',
    '```',
    'Terminal t1 100x30 revision 42',
    'semanticTree: available',
    'dialog "Permission" ref=semantic:n7@42 bounds=(8,20,40,9) modal',
    '  button "Approve" ref=semantic:n8@42 bounds=(14,23,11,1) focused',
    'visible text:',
    '…',
    '```',
    '',
    'The header `revision` is the **screen** revision — that is the `cursor` for',
    '`terminal.capture_since`. A ref\'s number is the **semantic** revision where it was minted.',
    'Stable semantic identities can be resolved again after the screen moves on. Frame-local',
    'identities and grid refs cannot; take a fresh snapshot when they become stale.',
    '',
    '`semanticTree: unavailable` means the program ships no adapter. Target those by `text`; there',
    'are no invented roles.',
    '',
    '## Targeting',
    '',
    'Precedence: `ref`, `selector`, `testId`, `role` (+`name`), `label`, `text`. Any name or text may',
    'be written `/pattern/flags` to match as a regular expression. Locators are strict — more than one',
    'match fails with `ambiguous-locator` and lists the candidates; pass `nth` to disambiguate, or use',
    '`terminal.query` first to see what matches.',
    '',
    '## Investigating a recorded failure',
    '',
    'A failing test run leaves a `.twtrace` archive. Replay it with the same vocabulary:',
    '',
    '1. `trace.open { path }` — validates the archive, returns a handle and what was recorded.',
    '2. `trace.overview { traceId }` — steps with status and timing, markers, exit, which step failed.',
    '3. `trace.frame_at { traceId, stepIndex | timeMs | marker }` — the screen at that moment, rebuilt,',
    '   with the semantic tree of the nearest revision. Reads exactly like a live snapshot.',
    '4. `trace.diff { traceId, fromMs, toMs }` — what moved between two moments.',
    '',
    'Start at the failed step from `trace.overview`, reconstruct it, then diff against a moment before',
    'it to see what changed. Handles are per session and the coldest is evicted at the ceiling — if one',
    'stops resolving, call `trace.open` again.',
    '',
    '## The application’s own log',
    '',
    'A terminal shows what a program *drew*; its log says what it *decided*. When the screen looks',
    'right and nothing happened, the answer is usually an `error` or `warn` line, not another pixel.',
    '',
    'Pass `logs: [{ path: "app.log", label: "app" }]` to `terminal.launch` and every',
    '`terminal.capture_since` returns the entries since your cursor, with `logsOmitted` when the',
    'buffer overflowed and `logCursor` to resume from. An existing file is followed from its end, so',
    'you never see the previous run.',
    '',
    'Two things worth knowing. A followed file is polled, so a line written just now may arrive on the',
    'next call — re-asking with the same cursor is lossless, never a reason to widen the window. And a',
    'log is application output like any other: it can contain tokens and personal data, so treat it',
    'with the same care as a crash screen tail.',
    '',
    'In a replay the same view is there: `trace.frame_at` carries the entries leading up to that',
    'moment and `trace.diff` the ones between two — so the question "what was it saying when the',
    'screen looked like this" is answered the same way live and after the fact.',
    '',
    '## Reading terminal modes',
    '',
    'A snapshot reports `modes`. Both mouse fields can read `unknown`, which means the platform hides',
    'the mode from the emulator — Windows ConPTY does — not that the program turned mouse reporting',
    'off. Clicks still go through there, encoded as SGR. So `unknown` is never a reason to fall back',
    'to keyboard-only interaction; a real `none` is.',
    '',
    '## Screenshots',
    '',
    '`terminal.snapshot` and `trace.frame_at` take `screenshot: true` (plus `screenshotScale` and',
    '`screenshotTheme`) and attach a PNG. The text and the compact tree come back in the same result,',
    'so ask for a picture only when pixels answer something the text cannot — alignment, colour, a',
    'glyph that looks wrong. Check `structuredContent.screenshot.selfContained`: when false, some',
    'character fell back to a font that may not exist where the image is viewed.',
    '',
    '## When the program dies',
    '',
    'A program that exits on its own — a signal, or a non-zero code nobody asked for — leaves a crash',
    'report. It rides along with whatever call failed next, and `terminal.capabilities` /',
    '`terminal.snapshot` show it instead of reporting a merely closed session. Read the exit status and',
    'the screen tail before retrying: a locator that never resolved because the program is gone looks',
    'like a timeout, and waiting longer will not bring it back. `trace.overview` shows the same section',
    'for a recording that carries one.',
    '',
    '**The screen tail is unredacted.** It is whatever the terminal displayed at the end — a stack',
    'trace, a config dump, an echoed password, whatever was there. Treat it like a screenshot of the',
    'user\'s machine: use it to diagnose, but do not paste it into issues, commit messages, chat',
    'transcripts or anywhere else it outlives the investigation. The one thing never recorded is the',
    'content of a paste — those carry secrets routinely, so only their size is kept.',
    '',
    '## When a call fails',
    '',
    'Failures come back with `isError` and a text block starting `error <kind>: <message>` plus a',
    '`suggestion`. Branch on the kind: `stale-snapshot` (re-snapshot), `ambiguous-locator` (narrow the',
    'target), `timeout` (the condition never held — read the screen excerpt), `not-found` (the path you',
    'named holds nothing — a typo, not a broken artifact; a corrupt archive reports',
    '`protocol-violation` instead), `probe-attach-failed` (a required semantic probe never attached),',
    '`capability-unavailable` (the frozen contract lacks the requested fact), `input-mode-disabled`',
    '(the app did not enable the required terminal input mode), `no-session` (bad handle),',
    '`history-truncated` (cursor too old). The same payload is in `_meta["io.termwright/error"]`.',
    '',
    'See `reference.md` for every tool and parameter, and `agent-context.json` for the machine-readable',
    'surface (enums, defaults, exit codes).',
    '',
    '## Command line',
    '',
    '```',
    buildUsage()
      .split('\n')
      .slice(2)
      .join('\n')
      .trim(),
    '```',
    '',
  ].join('\n');
}

/** The per-tool parameter reference the skill body links to. */
function renderReferenceMarkdown(): string {
  const context = buildAgentContext();
  const sections = context.tools.map((tool) =>
    [
      `## ${tool.name}`,
      '',
      tool.description,
      '',
      '**Input**',
      renderParameters(tool.inputSchema),
      '',
      '**Output**',
      renderParameters(tool.outputSchema),
      '',
    ].join('\n'),
  );
  return [
    `# ${SERVER_NAME} tool reference (${SERVER_VERSION})`,
    '',
    `Generated from the zod schemas of ${TOOLS.length} tools; do not edit by hand.`,
    '',
    ...sections,
    '## Exit codes',
    '',
    Object.entries(context.exitCodes)
      .map(([name, code]) => `- ${String(code)} — ${name}`)
      .join('\n'),
    '',
    '## Error kinds',
    '',
    context.enums.errorKinds.map((kind) => `- \`${kind}\``).join('\n'),
    '',
  ].join('\n');
}

/** Builds the agent-skill package in memory. */
export function buildAgentSkill(): readonly SkillFile[] {
  return [
    { path: 'SKILL.md', contents: renderSkillMarkdown() },
    { path: 'reference.md', contents: renderReferenceMarkdown() },
    { path: 'agent-context.json', contents: `${JSON.stringify(buildAgentContext(), null, 2)}\n` },
  ];
}

/** Writes the package into `directory`, creating it if needed. Returns the paths written. */
export async function writeAgentSkill(directory: string): Promise<readonly string[]> {
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const file of buildAgentSkill()) {
    const path = join(directory, file.path);
    await writeFile(path, file.contents, 'utf8');
    written.push(path);
  }
  return written;
}
