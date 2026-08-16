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
import { MARKER_OSC_CODE, MARKER_OSC_PREFIX } from '@termwright/protocol';
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

/**
 * A private mode set (`CSI ? <code> h`), optionally followed by a sequence that
 * undoes it. Modes are the other half of the ConPTY question: a marker only has
 * to reach the emulator, but a mode has to reach it *and* be reflected in
 * `Terminal.modes`, which is what the driver reports as capabilities.
 */
function decset(code: number, note: string, undo = ''): Candidate {
  return {
    name: `decset-${code}`,
    sequence: `${ESC}[?${code}h${undo}`,
    signature: new RegExp(`\\x1b\\[\\?[0-9;]*${code}[0-9;]*h`),
    leak: `[?${code}h`,
    note,
    listen: (terminal, seen) => {
      terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
        if (params.some((p) => (Array.isArray(p) ? p[0] : p) === code)) seen();
        // Never exclusive: xterm must still apply the mode, since whether the
        // mode lands in Terminal.modes is half of what is being measured.
        return false;
      });
    },
  };
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
    name: 'osc-8487-marker',
    sequence: `${ESC}]${MARKER_OSC_CODE};${MARKER_OSC_PREFIX}1;probe-marker-mac${BEL}`,
    signature: new RegExp(`\\x1b\\]${MARKER_OSC_CODE};${MARKER_OSC_PREFIX}1;probe-marker-mac`),
    leak: 'probe-marker-mac',
    note: 'the number the render marker actually rides — measured, not inferred from its class',
    listen: (terminal, seen) => {
      terminal.parser.registerOscHandler(MARKER_OSC_CODE, (data) => {
        if (data.endsWith('probe-marker-mac')) seen();
        return true;
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
  decset(1000, 'mouse tracking: clicks'),
  decset(1002, 'mouse tracking: drag — what the mouse fixtures enable'),
  decset(1006, 'SGR mouse encoding; without it coordinates are unusable past column 95'),
  decset(2004, 'bracketed paste: a mode the driver reports and paste() depends on'),
  decset(1004, 'focus reporting — contested: reported both as swallowed and as enabled by the host'),
  decset(1, 'application cursor keys, which decides what an arrow key must send'),
  {
    // Not a DECSET: the keypad modes are bare escapes, and a terminal that
    // filters by sequence family would treat them differently.
    name: 'deckpam',
    sequence: `${ESC}=`,
    signature: /\x1b=/,
    leak: '=',
    note: 'application keypad, set by a bare escape rather than a private mode',
    listen: (terminal, seen) => {
      terminal.parser.registerEscHandler({ final: '=' }, () => {
        seen();
        return false;
      });
    },
  },
  // Switched back immediately: on the alternate screen the sentinels and
  // PROBE-DONE would be written to a buffer this test never reads.
  decset(1049, 'alternate screen — believed to work, since semantic fixtures render', `${ESC}[?1049l`),
];

/**
 * Modes the driver reports, read straight off the emulator after the probe.
 * Every one of these is a claim the driver makes to a user, and a claim it can
 * only make if the request that set it survived the trip.
 */
function modesLine(terminal: Terminal): string {
  const modes = terminal.modes;
  return [
    `  modes after probe: mouseTracking=${modes.mouseTrackingMode}`,
    `bracketedPaste=${modes.bracketedPasteMode}`,
    `focusReporting=${modes.sendFocusMode}`,
    `applicationCursorKeys=${modes.applicationCursorKeysMode}`,
    `applicationKeypad=${modes.applicationKeypadMode}`,
  ].join(' ');
}

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

    const table = `${renderTable(verdicts)}\n${modesLine(terminal)}`;
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

  it('reports whether mouse input reaches a child whose DECSET we never saw', async () => {
    // The two directions are independent and this test exists because they can
    // disagree. If a terminal consumes the child's mouse DECSET on its way out,
    // the driver goes blind and refuses to click — but the child still has
    // mouse mode on and still understands a report. Whether the driver should
    // refuse or degrade depends on this measurement, not on the table above.
    const { terminal } = createTerminal({ columns: 60, rows: 10, scrollback: 0 });
    let pty: PtyProcess | undefined;
    let sawInput = false;
    try {
      pty = createNodePtyBackend().spawn({
        command: [process.execPath, join(FIXTURES, 'mouse-app.mjs')],
        env: environment(),
        columns: 60,
        rows: 10,
      });
      let queue: Promise<void> = Promise.resolve();
      pty.onData((chunk) => {
        queue = queue.then(
          () => new Promise<void>((resolve) => terminal.write(chunk, () => resolve())),
        );
      });

      await settle(() => gridText(terminal).includes('MOUSE ON'), () => queue);
      const modesSeen = `mouseTracking=${terminal.modes.mouseTrackingMode}`;

      // Exactly the bytes a click sends, written past every capability gate.
      pty.write(Buffer.from('\x1b[<0;1;1M\x1b[<0;1;1m', 'binary'));
      await settle(() => /MOUSE press|RAW:/.test(gridText(terminal)), () => queue);

      const screen = gridText(terminal);
      sawInput = /MOUSE press b=0/.test(screen);
      console.log(
        `[mouse probe] platform=${process.platform} ${modesSeen} childDecodedReport=${sawInput}\n${screen}`,
      );
      expect(screen, screen).toContain('MOUSE ON');
    } finally {
      pty?.dispose();
      terminal.dispose();
    }
  });
});

/** Polls a condition, draining the emulator's write chain between attempts. */
async function settle(done: () => boolean, drain: () => Promise<void>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await drain();
    if (done() || Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function gridText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
  }
  return lines.join('\n');
}
