/**
 * Escape-sequence permeability probe.
 *
 * This began as an investigation of the legacy, frame-based inbox ConPTY,
 * which re-rendered what it understood instead of forwarding the child's byte
 * stream. Termwright now ships a pinned passthrough ConPTY and this suite is a
 * regression probe: on every platform it measures which escape families
 * survive the PTY and remain usable by the emulator.
 *
 * Three independent things are measured per candidate, because they fail
 * differently:
 *
 * - **transport** — the byte signature appears in what the pty handed us. A
 *   sequence that fails here was eaten in transit and no parser can recover it.
 * - **parsed** — our handler on the emulator fired. A sequence can survive
 *   transport and still be useless if xterm does not expose it (APC has no
 *   handler API at all). The production marker is private OSC 8487.
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
import { describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { createNativePtyBackend, nativePtyAvailable } from './native-pty-backend.js';
import type { PtyProcess } from './pty.js';

const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });
const nativePressureIt = resourceAwareIt.resources({
  terminals: 1,
  traceWriters: 0,
  nativeHost: 'exclusive',
});

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
    // The code must match as a whole parameter. Without the boundaries `?1h`
    // matches inside `?1049h`, and the first Windows table duly reported a
    // sequence as transported that had in fact been eaten.
    signature: new RegExp(`\\x1b\\[\\?[0-9;]*(?<![0-9])${code}(?![0-9])[0-9;]*h`),
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
    note: 'historical candidate rejected on legacy inbox ConPTY; passthrough is now regression-tested',
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
  return nativePtyAvailable();
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
      pty = createNativePtyBackend().spawn({
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
      pty = createNativePtyBackend().spawn({
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
      // mouse-app enables 1000 and 1006 and nothing else, so focusReporting
      // here answers a question the escape table cannot: whether the host
      // turns focus reporting on by itself. A driver that believes an
      // unrequested 'true' sends CSI I to a child that will print it.
      const modesSeen =
        `mouseTracking=${terminal.modes.mouseTrackingMode}` +
        ` focusReporting=${terminal.modes.sendFocusMode} (never requested by this child)`;

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

describe.skipIf(!ptyAvailable())('application key modes through a real pty', { timeout: 30_000 }, () => {
  it('reports what a child in application mode receives for an arrow key', async () => {
    // The escape table showed `?1h` and `ESC =` not reaching the emulator on
    // Windows, which leaves the driver unable to tell which arrow encoding the
    // program wants. Whether that is a real defect depends on the other
    // direction: if the terminal rewrites what we write to match the mode it
    // kept for itself, the program gets the right bytes anyway.
    const { terminal } = createTerminal({ columns: 60, rows: 10, scrollback: 0 });
    let pty: PtyProcess | undefined;
    try {
      pty = createNativePtyBackend().spawn({
        command: [process.execPath, join(FIXTURES, 'appkeys-app.mjs')],
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

      await settle(() => gridText(terminal).includes('APPKEYS ON'), () => queue);
      const modes = `applicationCursorKeys=${terminal.modes.applicationCursorKeysMode} applicationKeypad=${terminal.modes.applicationKeypadMode}`;

      // Normal-mode Up, which is what the driver sends when it believes the
      // program is not in application mode.
      pty.write(Buffer.from('\x1b[A', 'binary'));
      await settle(() => /GOT:/u.test(gridText(terminal)), () => queue);
      // Application-mode Up, for comparison.
      pty.write(Buffer.from('\x1bOA', 'binary'));
      await settle(() => (gridText(terminal).match(/GOT:/gu) ?? []).length >= 2, () => queue);

      const received = [...gridText(terminal).matchAll(/GOT:([0-9a-f ]+)/gu)].map((m) => m[1]?.trim());
      console.log(
        `[appkeys probe] platform=${process.platform} ${modes}\n` +
          `  sent 1b 5b 41 (CSI A)  -> child got: ${received[0] ?? 'nothing'}\n` +
          `  sent 1b 4f 41 (SS3 A)  -> child got: ${received[1] ?? 'nothing'}`,
      );
      expect(gridText(terminal)).toContain('APPKEYS ON');
    } finally {
      pty?.dispose();
      terminal.dispose();
    }
  });
});

describe.skipIf(!ptyAvailable())('a flood through a real pty', { timeout: 120_000 }, () => {
  nativePressureIt('reports the gap when the output pipe is slower than the commit', async () => {
    // The other flood shape, and the one the conformance matrix reproduces:
    // the terminal, not the driver, is the slow part. A drain barrier cannot
    // see this — bytes still in the pty are bytes we do not have — so the two
    // cases need telling apart before either is called fixed.
    const renders = 30;
    const { terminal } = createTerminal({ columns: 80, rows: 24, scrollback: 0 });
    const gaps: number[] = [];
    const readingFrom = performance.now();
    terminal.parser.registerOscHandler(7777, (data) => {
      const childMs = Number(/t=([\d.]+)/u.exec(data)?.[1] ?? Number.NaN);
      if (Number.isFinite(childMs)) gaps.push(performance.now() - readingFrom - childMs);
      return true;
    });

    let pty: PtyProcess | undefined;
    try {
      pty = createNativePtyBackend().spawn({
        command: [process.execPath, join(FIXTURES, 'flood-probe-app.mjs')],
        env: {
          ...environment(),
          TERMWRIGHT_FLOOD_RENDERS: String(renders),
          TERMWRIGHT_FLOOD_BPS: '20000',
          TERMWRIGHT_FLOOD_CADENCE_MS: '10',
        },
        columns: 80,
        rows: 24,
      });
      let queue: Promise<void> = Promise.resolve();
      pty.onData((chunk) => {
        queue = queue.then(
          () => new Promise<void>((resolve) => terminal.write(chunk, () => resolve())),
        );
      });
      await settle(() => gaps.length >= renders, () => queue, 60_000);
    } finally {
      pty?.dispose();
    }

    // Absolute here, not relative to the first marker: the question is how
    // long after a commit its marker becomes visible, against a 1000 ms window.
    const sorted = [...gaps].sort((a, b) => a - b);
    const at = (f: number): number => sorted[Math.floor((sorted.length - 1) * f)] ?? 0;
    console.log(
      `[throttled probe] platform=${process.platform} renders=${renders} seen=${gaps.length}\n` +
        `  commit-to-sighting ms: p50=${at(0.5).toFixed(0)} p90=${at(0.9).toFixed(0)} max=${at(1).toFixed(0)}`,
    );
    expect(gaps.length).toBeGreaterThan(0);
    terminal.dispose();
  });

  nativePressureIt('reports how far behind a commit marker falls when renders come back to back', async () => {
    // Why this exists: on Windows a flood leaves the revision chain stalled
    // with markers expiring, and two explanations fit — the terminal delays
    // the marker past the pairing window, or the driver simply cannot drink
    // that fast. The added latency below separates them, and the byte ratio
    // says whether the terminal is handing us more than the child wrote.
    const renders = 200;
    const { terminal } = createTerminal({ columns: 80, rows: 24, scrollback: 0 });

    interface Sighting {
      readonly seq: number;
      /** Child clock, ms since its start. */
      readonly childMs: number;
      /** Driver clock, ms since this test started reading. */
      readonly driverMs: number;
    }
    const sightings: Sighting[] = [];
    const readingFrom = performance.now();
    terminal.parser.registerOscHandler(7777, (data) => {
      const seq = Number(/seq=(\d+)/u.exec(data)?.[1] ?? Number.NaN);
      const childMs = Number(/t=([\d.]+)/u.exec(data)?.[1] ?? Number.NaN);
      if (Number.isFinite(seq) && Number.isFinite(childMs)) {
        sightings.push({ seq, childMs, driverMs: performance.now() - readingFrom });
      }
      return true;
    });

    // When the bytes of each marker landed, before the emulator saw them. The
    // gap between this and the sighting is ours, not the terminal's.
    const rawAt = new Map<number, number>();
    let tail = '';
    const scanRaw = (chunk: Uint8Array): void => {
      tail = (tail + Buffer.from(chunk).toString('binary')).slice(-4096);
      for (const match of tail.matchAll(/seq=(\d+);t=[\d.]+/gu)) {
        const seq = Number(match[1]);
        if (!rawAt.has(seq)) rawAt.set(seq, performance.now() - readingFrom);
      }
    };

    let bytesReceived = 0;
    let pty: PtyProcess | undefined;
    try {
      pty = createNativePtyBackend().spawn({
        command: [process.execPath, join(FIXTURES, 'flood-probe-app.mjs')],
        env: { ...environment(), TERMWRIGHT_FLOOD_RENDERS: String(renders) },
        columns: 80,
        rows: 24,
      });
      let queue: Promise<void> = Promise.resolve();
      pty.onData((chunk) => {
        bytesReceived += chunk.length;
        scanRaw(chunk);
        queue = queue.then(
          () => new Promise<void>((resolve) => terminal.write(chunk, () => resolve())),
        );
      });

      await settle(() => sightings.length >= renders, () => queue, 60_000);
    } finally {
      pty?.dispose();
    }

    // Latency the transport added, measured against the first marker so the
    // two clocks never have to agree on an origin.
    const first = sightings[0];
    const quantiles = (values: readonly number[]): string => {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (f: number): number => sorted[Math.floor((sorted.length - 1) * f)] ?? 0;
      return `p50=${at(0.5).toFixed(0)} p90=${at(0.9).toFixed(0)} max=${at(1).toFixed(0)}`;
    };
    const relative = (arrival: (s: Sighting) => number | undefined, base: number): number[] =>
      first === undefined
        ? []
        : sightings.flatMap((s) => {
            const value = arrival(s);
            return value === undefined ? [] : [value - base - (s.childMs - first.childMs)];
          });
    const firstRaw = rawAt.get(first?.seq ?? 0) ?? 0;
    const bytesWritten = renders * (40 * 60);

    console.log(
      [
        `[flood probe] platform=${process.platform} renders=${renders} seen=${sightings.length}`,
        // Two latencies, because they have different owners. 'bytes' is what
        // the terminal delayed; 'parsed' also carries our own write queue, and
        // it is 'parsed' that the pairing timeout races.
        `  added latency ms, bytes:  ${quantiles(relative((s) => rawAt.get(s.seq), firstRaw))}`,
        `  added latency ms, parsed: ${quantiles(relative((s) => s.driverMs, first?.driverMs ?? 0))}`,
        `  bytes: child~${bytesWritten} received=${bytesReceived} ratio=${(bytesReceived / bytesWritten).toFixed(2)}`,
        `  wall ms: ${(sightings.at(-1)?.driverMs ?? 0).toFixed(0)}`,
      ].join('\n'),
    );

    // Deliberately not a throughput assertion: how fast a terminal can be
    // driven is a measurement, and pinning it here would turn a slow runner
    // into a failing driver. Only the probe's own sanity is asserted.
    expect(sightings.length).toBeGreaterThan(0);
    terminal.dispose();
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
