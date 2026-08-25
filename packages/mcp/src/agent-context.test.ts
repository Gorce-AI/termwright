import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAgentContext, buildUsage, TARGETING_GUIDANCE } from './agent-context.js';
import { buildAgentSkill, renderMcpToolSurfaceMarkdown } from './agent-skill.js';
import { EXIT_CODES, exitCodeFor } from './errors.js';
import { runCli } from './cli.js';
import { TOOLS } from './registry.js';
import { TERMINAL_TOOLS } from './tools.js';
import { TRACE_TOOLS } from './trace-tools.js';

/** The live-terminal tool names CONTRACTS.md §MCP requires. */
const CONTRACT_TOOLS = [
  'terminal.launch',
  'terminal.capabilities',
  'terminal.snapshot',
  'terminal.capture_since',
  'terminal.query',
  'terminal.checkpoint',
  'terminal.actionability',
  'terminal.click',
  'terminal.double_click',
  'terminal.hover',
  'terminal.press',
  'terminal.type',
  'terminal.fill',
  'terminal.check',
  'terminal.uncheck',
  'terminal.paste',
  'terminal.write_raw',
  'terminal.drag',
  'terminal.wheel',
  'terminal.resize',
  'terminal.signal',
  'terminal.scrollback',
  'terminal.select_cells',
  'terminal.copy_selection',
  'terminal.wait_for',
  'terminal.close',
];

/** The replay tools, added for agent-driven failure analysis (task #17). */
const REPLAY_TOOLS = ['trace.open', 'trace.overview', 'trace.frame_at', 'trace.diff'];

/** Everything the server registers, in registration order. */
const ALL_TOOLS = [...CONTRACT_TOOLS, ...REPLAY_TOOLS];

describe('the tool surface', () => {
  it('covers exactly the live tools CONTRACTS.md §MCP lists', () => {
    expect(TERMINAL_TOOLS.map((tool) => tool.name)).toEqual(CONTRACT_TOOLS);
  });

  it('adds the replay tools after them, without disturbing the contract order', () => {
    expect(TRACE_TOOLS.map((tool) => tool.name)).toEqual(REPLAY_TOOLS);
    expect(TOOLS.map((tool) => tool.name)).toEqual(ALL_TOOLS);
  });

  it('gives every tool an input and an output schema', () => {
    for (const tool of TOOLS) {
      expect(Object.keys(tool.inputSchema).length, tool.name).toBeGreaterThan(0);
      expect(Object.keys(tool.outputSchema).length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
    }
  });
});

describe('agent-context', () => {
  const context = buildAgentContext();

  it('is generated from the live schemas, not hand-written', () => {
    expect(context.tools.map((tool) => tool.name)).toEqual(ALL_TOOLS);
    const snapshot = context.tools.find((tool) => tool.name === 'terminal.snapshot');
    const properties = snapshot?.inputSchema['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toContain('variant');
    expect(JSON.stringify(properties['variant'])).toContain('full');
  });

  it('publishes the enums an agent has to guess otherwise', () => {
    expect(context.enums.roles).toContain('button');
    expect(context.enums.states).toContain('focused');
    expect(context.enums.signals).toEqual(['INT', 'TERM', 'KILL', 'HUP']);
    expect(context.enums.errorKinds).toContain('stale-snapshot');
  });

  it('publishes the exit-code taxonomy from CONTRACTS.md', () => {
    expect(context.exitCodes).toEqual({ ok: 0, assertion: 1, usage: 2, noSession: 3, ipc: 4, internal: 5 });
  });

  it('serialises to JSON', () => {
    expect(() => JSON.stringify(context)).not.toThrow();
    expect(context.v).toBe(1);
  });
});

describe('exit codes', () => {
  it('maps every kind onto the taxonomy', () => {
    expect(exitCodeFor('usage')).toBe(EXIT_CODES.usage);
    expect(exitCodeFor('no-session')).toBe(EXIT_CODES.noSession);
    expect(exitCodeFor('session-closed')).toBe(EXIT_CODES.noSession);
    expect(exitCodeFor('protocol-violation')).toBe(EXIT_CODES.ipc);
    expect(exitCodeFor('internal')).toBe(EXIT_CODES.internal);
    expect(exitCodeFor('timeout')).toBe(EXIT_CODES.assertion);
  });
});

describe('the CLI', () => {
  function collect(): { io: { out: (t: string) => void; err: (t: string) => void }; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (t) => out.push(t), err: (t) => err.push(t) }, out, err };
  }

  it('prints the cheat sheet on usage', async () => {
    const sink = collect();
    expect(await runCli(['usage'], sink.io)).toBe(EXIT_CODES.ok);
    expect(sink.out.join('\n')).toContain('terminal.capture_since');
  });

  it('prints agent-context as JSON', async () => {
    const sink = collect();
    expect(await runCli(['agent-context'], sink.io)).toBe(EXIT_CODES.ok);
    const parsed = JSON.parse(sink.out.join('\n')) as { tools: { name: string }[] };
    expect(parsed.tools).toHaveLength(ALL_TOOLS.length);
  });

  it('exits 2 on unknown arguments, and carries a kind under --json', async () => {
    const plain = collect();
    expect(await runCli(['--nope'], plain.io)).toBe(EXIT_CODES.usage);

    const json = collect();
    expect(await runCli(['--json', '--nope'], json.io)).toBe(EXIT_CODES.usage);
    expect(JSON.parse(json.err[0] ?? '{}')).toMatchObject({ kind: 'usage' });
  });

  it('validates --port', async () => {
    const sink = collect();
    expect(await runCli(['--http', '--port', 'nope'], sink.io)).toBe(EXIT_CODES.usage);
  });

  it('never prints a stack trace', async () => {
    const sink = collect();
    await runCli(['--nope'], sink.io);
    expect(sink.err.join('\n')).not.toMatch(/\n\s+at /u);
  });
});

describe('usage output', () => {
  it('fits on one screen', () => {
    expect(buildUsage().split('\n').length).toBeLessThanOrEqual(30);
  });
});

describe('the agent-skill package', () => {
  const files = buildAgentSkill();

  it('emits SKILL.md, a reference and the machine-readable context', () => {
    expect(files.map((file) => file.path)).toEqual(['SKILL.md', 'reference.md', 'agent-context.json']);
  });

  it('gives SKILL.md the frontmatter a host matches on', () => {
    const skill = files[0]?.contents ?? '';
    expect(skill.startsWith('---\nname: termwright\ndescription: ')).toBe(true);
    expect(skill).toContain('stale-snapshot');
    expect(skill).toContain('terminal.capture_since');
  });

  it('uses the product targeting model when no semantic tree is available', () => {
    const skill = files[0]?.contents ?? '';
    const context = buildAgentContext();

    expect(context.conventions).toContain(TARGETING_GUIDANCE.precedence);
    expect(context.conventions).toContain(TARGETING_GUIDANCE.semanticUnavailable);
    expect(skill).toContain(TARGETING_GUIDANCE.precedence);
    expect(skill).toContain(TARGETING_GUIDANCE.semanticUnavailable);
    expect(skill).not.toContain('Target those by `text`');
  });

  it('documents every tool and its parameters in the reference', () => {
    const reference = files[1]?.contents ?? '';
    for (const name of ALL_TOOLS) expect(reference).toContain(`## ${name}`);
    expect(reference).toContain('`cursor`: integer — revision returned by an earlier snapshot');
  });

  it('renders every registered tool into the committed documentation surface', () => {
    const surface = renderMcpToolSurfaceMarkdown();
    for (const name of ALL_TOOLS) expect(surface).toContain(`| \`${name}\` |`);
    expect(surface).toContain(TARGETING_GUIDANCE.semanticUnavailable);
  });

  it('ships the same agent-context the CLI prints', () => {
    expect(JSON.parse(files[2]?.contents ?? '{}')).toEqual(JSON.parse(JSON.stringify(buildAgentContext())));
  });

  it('writes the package to a directory on request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-skill-'));
    const sink = { out: (): void => {}, err: (): void => {} };
    expect(await runCli(['skill', '--out', directory], sink)).toBe(EXIT_CODES.ok);
    expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toContain('name: termwright');
    expect(JSON.parse(await readFile(join(directory, 'agent-context.json'), 'utf8')).v).toBe(1);
  });

  it('prints the package to stdout when no directory is given', async () => {
    const out: string[] = [];
    const code = await runCli(['skill'], { out: (text) => out.push(text), err: () => {} });
    expect(code).toBe(EXIT_CODES.ok);
    expect(out.join('\n')).toContain('=== SKILL.md');
  });
});
