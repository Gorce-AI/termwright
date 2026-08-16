/**
 * Generic (uninstrumented) conformance fixture — origin spec §20.1.
 *
 * It imports nothing from termwright and never reads `TERMWRIGHT_ENDPOINT`, so
 * a driver attached to it must fall back to a generic session: no handshake, no
 * tree, no invented roles. Everything it can be asked to do is driven by real
 * PTY bytes, and every observation it makes is printed back onto the screen so
 * a test can assert on it without a semantic channel.
 *
 * Keys:
 *   ArrowUp/ArrowDown  move the menu selection
 *   Enter              activate the selected item
 *   m / M              mouse click reporting / drag reporting on, again to disable
 *   b                  bracketed paste on/off
 *   f                  focus reporting on/off
 *   a                  enter/leave the alternate screen
 *   u                  toggle the Unicode sample row (emoji, ZWJ, combining, CJK)
 *   w                  toggle a long line, so reflow is observable on resize
 *   s                  stream 120 plain lines into the scrollback and stop repainting
 *   r                  resume repainting after `s`
 *   q                  exit 0        x    exit 7
 *
 * Every other keystroke is echoed as `KEY:<hex bytes>`, which is how the suites
 * prove that a key encoded by the driver reached the child as the exact bytes a
 * terminal would have sent.
 */

const ITEMS = ['Alpha', 'Beta', 'Gamma'];

// `--pidfile=<path>` writes this process's pid at startup. It is how a suite
// proves *which* children an owner actually killed: a pid can be probed with
// signal 0 long after the process that launched it stopped watching.
const pidfileArg = process.argv.find((argument) => argument.startsWith('--pidfile='));
if (pidfileArg !== undefined) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(pidfileArg.slice('--pidfile='.length), String(process.pid), 'utf8');
}

let selected = 0;
let activated = 'none';
// Four slots, filled from the start: the row layout must not move when the
// first event arrives, or every coordinate assertion would depend on history.
const events = ['none', 'none', 'none', 'none'];
const note = (event) => {
  events.push(event);
  while (events.length > 4) events.shift();
};
let mouse = 'off';
let bracketed = false;
let focusReporting = false;
let alternate = false;
let unicode = false;
let wide = false;
let painting = true;

const out = (text) => process.stdout.write(text);

function draw() {
  if (!painting) return;
  out('\x1b[H\x1b[J');
  out('GENERIC READY\r\n');
  for (const [index, item] of ITEMS.entries()) {
    // The selected row is styled, so style predicates (fg/bg/attributes) have
    // something to discriminate on that plain text does not.
    out(index === selected ? `\x1b[1;32m> ${item}\x1b[0m\r\n` : `  ${item}\r\n`);
  }
  out('\x1b[31mRED\x1b[0m \x1b[4mUNDER\x1b[0m \x1b[44mONBLUE\x1b[0m\r\n');
  out(`modes: mouse=${mouse} paste=${bracketed ? 'on' : 'off'} focus=${focusReporting ? 'on' : 'off'}`);
  out(` alt=${alternate ? 'on' : 'off'}\r\n`);
  out(`size: ${process.stdout.columns}x${process.stdout.rows}\r\n`);
  out(`activated: ${activated}\r\n`);
  if (alternate) out('ALT SCREEN\r\n');
  for (const event of events) out(`ev: ${event}\r\n`);
  // Printed last on purpose: an extra row above the event log would move every
  // coordinate the suites assert on. Reports whether a variable set in the test
  // process reached the child, which is what `envMode` decides.
  out(`env: ${process.env['CONFORMANCE_ECHO'] ?? 'unset'}\r\n`);
  // Which of the documented allowlist actually arrived. A child that lost PATH
  // or TERM is broken in ways that look like a driver bug much later. The home
  // variable is named per platform because the allowlist is: Windows has no
  // `HOME`, and a program there uses the profile variables instead.
  // `TERM` and `COLORTERM` are not inherited but set by the driver, so their
  // values are the claim rather than their presence. Printed before `allow:`,
  // which several suites wait on as the last line of the frame.
  out(`term: ${process.env['TERM'] ?? 'unset'}/${process.env['COLORTERM'] ?? 'unset'}\r\n`);
  const home = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const allow = ['PATH', home, 'LANG']
    .map((name) => `${name}=${process.env[name] === undefined ? 'no' : 'yes'}`)
    .join(' ');
  out(`allow: ${allow}\r\n`);
  if (unicode) out('U: \u{1F600} \u{1F469}\u200D\u{1F469}\u200D\u{1F467} e\u0301 \u65E5\u672C\u8A9E ok\r\n');
  if (wide) out(`W: ${'0123456789'.repeat(12)} END\r\n`);
}

function setMouse(mode) {
  if (mouse !== 'off') out('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
  mouse = mode;
  if (mode === 'click') out('\x1b[?1000h\x1b[?1006h');
  if (mode === 'drag') out('\x1b[?1002h\x1b[?1006h');
}

function hex(text) {
  return [...Buffer.from(text, 'utf8')].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

function command(key) {
  switch (key) {
    case 'q':
      out('BYE\r\n');
      process.exit(0);
      return true;
    case 'x':
      out('BYE\r\n');
      process.exit(7);
      return true;
    case '\r':
      activated = ITEMS[selected];
      return true;
    case 'm':
      setMouse(mouse === 'click' ? 'off' : 'click');
      return true;
    case 'M':
      setMouse(mouse === 'drag' ? 'off' : 'drag');
      return true;
    case 'b':
      bracketed = !bracketed;
      out(bracketed ? '\x1b[?2004h' : '\x1b[?2004l');
      return true;
    case 'f':
      focusReporting = !focusReporting;
      out(focusReporting ? '\x1b[?1004h' : '\x1b[?1004l');
      return true;
    case 'a':
      alternate = !alternate;
      out(alternate ? '\x1b[?1049h' : '\x1b[?1049l');
      // Leaving the alternate screen must leave the restored normal buffer
      // exactly as the terminal restored it — repainting over it would hide
      // whether the restore happened at all.
      painting = alternate;
      return true;
    case 'u':
      unicode = !unicode;
      return true;
    case 'w':
      wide = !wide;
      return true;
    case 's': {
      painting = false;
      out('\x1b[H\x1b[J');
      for (let line = 1; line <= 120; line += 1) out(`line ${line}\r\n`);
      out('SCROLL DONE\r\n');
      return true;
    }
    case 'r':
      painting = true;
      return true;
    default:
      return false;
  }
}

/** Consumes one event from the head of `rest`; returns the unconsumed tail. */
function step(rest) {
  if (bracketed && rest.startsWith('\x1b[200~')) {
    const end = rest.indexOf('\x1b[201~');
    if (end < 0) return null; // incomplete paste: wait for the rest
    note(`PASTE:${rest.slice(6, end)}`);
    return rest.slice(end + 6);
  }
  if (rest.startsWith('\x1b[I')) {
    note('FOCUS:in');
    return rest.slice(3);
  }
  if (rest.startsWith('\x1b[O')) {
    note('FOCUS:out');
    return rest.slice(3);
  }
  const report = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/u.exec(rest);
  if (report !== null) {
    const [, button, column, row, final] = report;
    const kind = final === 'm' ? 'release' : Number(button) >= 64 ? 'wheel' : 'press';
    note(`MOUSE ${kind} b=${button} c=${column} r=${row}`);
    if (kind === 'press' && Number(button) < 32) {
      // The fixture decides what a double click is, so a test can wait for one
      // event instead of counting two identical ones — a count on a repainted
      // screen is satisfied by the first of the pair as soon as it lands.
      const at = Date.now();
      const cell = `c=${column} r=${row}`;
      if (lastPress.cell === cell && at - lastPress.at < 500) note(`MOUSE dblclick ${cell}`);
      lastPress = { cell, at };
    }
    return rest.slice(report[0].length);
  }
  if (rest.startsWith('\x1b[A')) {
    selected = (selected + ITEMS.length - 1) % ITEMS.length;
    return rest.slice(3);
  }
  if (rest.startsWith('\x1b[B')) {
    selected = (selected + 1) % ITEMS.length;
    return rest.slice(3);
  }
  // An unrecognised escape sequence is reported as one event, not as the four
  // stray bytes it is made of, so a test can assert on the encoding of a key.
  const escape = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O[@-~]|.)/u.exec(rest);
  if (escape !== null) {
    note(`KEY:${hex(escape[0])}`);
    return rest.slice(escape[0].length);
  }
  const head = [...rest][0] ?? rest[0];
  if (!command(head)) note(`KEY:${hex(head)}`);
  return rest.slice(head.length);
}

let lastPress = { cell: '', at: 0 };
let pending = '';

process.stdout.write('\x1b]0;generic-app\x07');
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  pending += chunk.toString('utf8');
  for (;;) {
    if (pending.length === 0) break;
    const rest = step(pending);
    if (rest === null) break; // incomplete sequence
    pending = rest;
  }
  draw();
});

process.stdout.on('resize', () => {
  note(`RESIZE:${process.stdout.columns}x${process.stdout.rows}`);
  draw();
});

draw();
