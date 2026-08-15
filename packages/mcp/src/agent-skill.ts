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
import { TOOLS } from './tools.js';
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
    'dialog "Permission" ref=n7@42 bounds=(8,20,40,9) modal',
    '  button "Approve" ref=n8@42 bounds=(14,23,11,1) focused',
    'visible text:',
    '…',
    '```',
    '',
    'The header `revision` is the **screen** revision — that is the `cursor` for',
    '`terminal.capture_since`. A ref\'s number is the **semantic** revision: `n8@42` is valid only',
    'while 42 is live, and reusing it after the screen moved on fails with `stale-snapshot`. The fix',
    'is always to snapshot again, never to retry the same ref.',
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
    '## When a call fails',
    '',
    'Failures come back with `isError` and a text block starting `error <kind>: <message>` plus a',
    '`suggestion`. Branch on the kind: `stale-snapshot` (re-snapshot), `ambiguous-locator` (narrow the',
    'target), `timeout` (the condition never held — read the screen excerpt), `unsupported-action` (the',
    'program never enabled mouse tracking, or has no semantic tree), `no-session` (bad handle),',
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
