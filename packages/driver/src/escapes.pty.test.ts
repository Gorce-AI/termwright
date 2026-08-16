/**
 * Escape-sequence permeability probe.
 *
 * The Windows CI run proved that a session's render marker never reaches the
 * emulator while everything else about the session works, which points at
 * ConPTY: it is an emulator sitting between the child and us, not a pipe, and
 * it re-emits what it understood rather than forwarding what it received. This
 * suite measures, on whatever platform it runs, which escape families actually
 * survive that trip — the answer decides how a render marker may be encoded.
 *
 * Three independent things are measured per candidate, because they fail
 * differently:
 *
 * - **transport** — the byte signature appears in what the pty handed us. A
 *   sequence that fails here was eaten in transit and no parser can recover it.
 * - **parsed** — our handler on the emulator fired. A sequence can survive
 *   transport and still be useless if xterm does not expose it (APC has no
 *   handler API at all, which is why the driver's marker is a DCS today).
 * - **leaked** — the payload showed up as visible text on the grid. A sequence
 *   whose introducer is stripped while its payload survives is worse than one
 *   that vanishes: it corrupts every screen assertion the user writes.
 *
 * The table is printed unconditionally. The assertions are deliberately narrow:
 * they check that the probe itself ran (positive control, sentinels, DONE) and
 * that nothing leaked. Which candidates survive is the measurement, not a
 * requirement — a red suite here would hide the number we came for.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTerminal, type Terminal } from '@termwright/vt';
import { describe, expect, it } from 'vitest';
import { createNodePtyBackend, type PtyProcess } from './pty.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures');

const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;

/** One sequence under test, with everything needed to judge its fate. */
interface Candidate {
  /** Identifier used in the printed table and in the sentinel line. */
  readonly name: string;
  /** Exactly what the child writes. */
  readonly sequence: string;
  /**
   * Byte signature searched for in the raw pty output. Matches the introducer
   * plus the start of the payload rather than the whole sequence: a terminal
   * may legitimately re-encode a terminator (`BEL` for `ST`) or renumber
   * parameters while still forwarding the sequence.
   */
  readonly signature: RegExp;
  /** Payload text whose appearance on the grid means the escape was stripped. */
  readonly leak: string;
  /** Registers the emulator handler; returns nothing when none can exist. */
  readonly listen?: (terminal: Terminal, seen: () => void) => void;
  /** Why this candidate is in the list. */
  readonly note: string;
}

const CANDIDATES: readonly Candidate[] = [
  {
    name: 'sgr',
    sequence: `${ESC}[31mRED${ESC}[0m`,
    signature: /\x1b\[[0-9;]*31[0-9;]*m/,
    leak: '[31m',
    note: 'positive control: if this fails the probe is broken, not the terminal',
    listen: (terminal, seen) => {
      terminal.parser.registerCsiHandler({ final: 'm' }, (params) => {
        if (params.some((p) => (Array.isArray(p) ? p[0] : p) === 31)) seen();
        return false;
      });
    },
  },
  {
    name: 'dcs',
    sequence: `${ESC}Ptwm;0;probe-dcs${ST}`,
    signature: /\x1bPtwm;0;probe-dcs/,
    leak: 'probe-dcs',
    note: 'negative control / status quo: how the render marker is encoded today',
    listen: (terminal, seen) => {
      terminal.parser.registerDcsHandler({ final: 't' }, (data) => {
        if (data.startsWith('wm;0;probe-dcs')) seen();
        return true;
      });
    },
  },
  {
    name: 'osc-private-bel',
    sequence: `${ESC}]7777;probe-obel${BEL}`,
    signature: /\x1b\]7777;probe-obel/,
    leak: 'probe-obel',
    note: 'private OSC, BEL-terminated — the form most terminals forward',
    listen: (terminal, seen) => {
      terminal.parser.registerOscHandler(7777, (data) => {
        if (data === 'probe-obel') seen();
        return true;
      });
    },
  },
  {
    name: 'osc-private-st',
    sequence: `${ESC}]7778;probe-ost${ST}`,
    signature: /\x1b\]7778;probe-ost/,
    leak: 'probe-ost',
    note: 'same, ST-terminated: terminators are forwarded independently',
    listen: (terminal, seen) => {
      terminal.parser.registerOscHandler(7778, (data) => {
        if (data === 'probe-ost') seen();
        return true;
      });
    },
  },
  {
    name: 'osc8-hyperlink',
    sequence: `${ESC}]8;id=twprobe;https://termwright.invalid/probe${ST}link${ESC}]8;;${ST}`,
    signature: /\x1b\]8;id=twprobe;/,
    leak: 'twprobe',
    note: 'standard OSC with an id parameter — a well-known sequence terminals keep',
    listen: (terminal, seen) => {
      terminal.parser.registerOscHandler(8, (data) => {
        if (data.includes('id=twprobe')) seen();
        return false;
      });
    },
  },
  {
    name: 'osc133-mark',
    sequence: `${ESC}]133;A${ST}`,
    signature: /\x1b\]133;A/,
    leak: '133;A',
    note: 'shell integration: the driver already depends on this reaching it',
    listen: (terminal, seen) => {
      terminal.parser.registerOscHandler(133, (data) => {
        if (data.startsWith('A')) seen();
        return false;
      });
    },
  },
  {
    name: 'apc',
    sequence: `${ESC}_probe-apc${ST}`,
    signature: /\x1b_probe-apc/,
    leak: 'probe-apc',
    note: 'xterm exposes no APC handler, so only transport and leakage are measurable',
  },
];

interface Verdict {
  readonly name: string;
  readonly transport: boolean;
  readonly parsed: boolean | null;
  readonly leaked: boolean;
}

function environment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function ptyAvailable(): boolean {
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') return false;
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: environment(),
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return true;
  } catch {
    return false;
  }
}

function renderTable(verdicts: readonly Verdict[]): string {
  const mark = (value: boolean | null): string =>
    value === null ? 'n/a  ' : value ? 'yes  ' : 'NO   ';
  const rows = verdicts.map(
    (v) => `  ${v.name.padEnd(18)} transport=${mark(v.transport)} parsed=${mark(v.parsed)} leaked=${mark(v.leaked)}`,
  );
  return [`[escape probe] platform=${process.platform}`, ...rows].join('\n');
}

describe.skipIf(!ptyAvailable())('escape sequences through a real pty', { timeout: 30_000 }, () => {
  it('reports which escape families survive the pty', async () => {
    const spec = CANDIDATES.map((candidate) => ({
      name: candidate.name,
      sequence: [...candidate.sequence].map((char) => char.charCodeAt(0)),
    }));

    const { terminal } = createTerminal({ columns: 80, rows: 24, scrollback: 200 });
    const parsed = new Map<string, boolean>();
    for (const candidate of CANDIDATES) {
      if (candidate.listen === undefined) continue;
      parsed.set(candidate.name, false);
      candidate.listen(terminal, () => parsed.set(candidate.name, true));
    }

    let raw = '';
    let pty: PtyProcess | undefined;
    try {
      pty = createNodePtyBackend().spawn({
        command: [process.execPath, join(FIXTURES, 'escape-probe-app.mjs')],
        env: {
          ...environment(),
          TERMWRIGHT_PROBE_SPEC: Buffer.from(JSON.stringify(spec), 'utf8').toString('base64'),
        },
        columns: 80,
        rows: 24,
      });

      // Writes are chained so the emulator parses chunks in arrival order; the
      // chain is also what the deadline below waits on.
      let queue: Promise<void> = Promise.resolve();
      pty.onData((chunk) => {
        raw += Buffer.from(chunk).toString('binary');
        queue = queue.then(
          () => new Promise<void>((resolve) => terminal.write(chunk, () => resolve())),
        );
      });

      const deadline = Date.now() + 15_000;
      for (;;) {
        await queue;
        if (gridText(terminal).includes('PROBE-DONE')) break;
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await queue;
    } finally {
      pty?.dispose();
    }

    const screen = gridText(terminal);
    const verdicts: Verdict[] = CANDIDATES.map((candidate) => ({
      name: candidate.name,
      transport: candidate.signature.test(raw),
      parsed: parsed.get(candidate.name) ?? null,
      leaked: screen.includes(candidate.leak),
    }));

    const table = renderTable(verdicts);
    // Printed before any assertion: a failing assertion must not take the
    // measurement down with it — the table is what this test exists to produce.
    console.log(table);

    const report = `${table}\nscreen:\n${screen}`;

    // The probe ran at all: every sentinel and the terminator arrived.
    for (const candidate of CANDIDATES) {
      expect(screen, report).toContain(`SENT`);
      expect(screen, report).toContain(candidate.name);
    }
    expect(screen, report).toContain('PROBE-DONE');

    // Positive control: plain SGR must cross any terminal worth the name.
    const sgr = verdicts.find((v) => v.name === 'sgr');
    expect(sgr?.transport, report).toBe(true);
    expect(sgr?.parsed, report).toBe(true);

    // A stripped introducer that leaves its payload behind would put garbage
    // into every screen assertion downstream — that is a defect anywhere.
    for (const verdict of verdicts) {
      expect(verdict.leaked, `${verdict.name} leaked its payload onto the grid\n${report}`).toBe(
        false,
      );
    }

    terminal.dispose();
  });
});

function gridText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
  }
  return lines.join('\n');
}
