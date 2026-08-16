/**
 * Flood probe: writes many "renders" back to back, each committed by a private
 * OSC carrying its sequence number and the child's own clock reading.
 *
 * The clock reading is what makes the measurement possible. Child and driver
 * run on different clocks, so no arrival time is meaningful on its own — but
 * the difference between two markers is, and comparing that difference on both
 * ends gives the latency the transport ADDED, with no clock alignment needed.
 *
 * `TERMWRIGHT_FLOOD_RENDERS` renders (default 200), `TERMWRIGHT_FLOOD_LINES`
 * lines of filler each (default 40, enough to scroll a normal window and make
 * a repainting terminal work for its living).
 */
const renders = Number(process.env['TERMWRIGHT_FLOOD_RENDERS'] ?? '200');
const lines = Number(process.env['TERMWRIGHT_FLOOD_LINES'] ?? '40');
/**
 * Optional throttle, in bytes per second, modelling a terminal slower than the
 * semantic socket. Unlike a fixed delay it builds a backlog while the flood
 * lasts and drains after it stops, which is how a re-encoding pty behaves.
 */
const bps = Number(process.env['TERMWRIGHT_FLOOD_BPS'] ?? '0');
/**
 * The cadence the renders claim, in ms. With a throttle, this is what makes
 * the backlog GROW rather than sit at one frame: the adapter commits at its
 * own pace (its trees reaching the socket at once) while its output drains
 * slower, exactly the asymmetry a re-encoding pty creates. 0 uses real time.
 */
const cadenceMs = Number(process.env['TERMWRIGHT_FLOOD_CADENCE_MS'] ?? '0');

const start = process.hrtime.bigint();
const elapsedMs = () => Number(process.hrtime.bigint() - start) / 1e6;

let written = 0;
const write = (text) => {
  written += Buffer.byteLength(text, 'utf8');
  process.stdout.write(text);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let render = 1; render <= renders; render += 1) {
  // When the render happened — the moment an adapter would put its tree on
  // the socket. The marker carries this, not the time its bytes go out, so
  // the driver can measure the gap the pairing window actually races.
  const committedAt = cadenceMs > 0 ? render * cadenceMs : elapsedMs();
  let frame = '';
  for (let line = 0; line < lines; line += 1) {
    frame += `render ${render} line ${line} ${'.'.repeat(40)}\r\n`;
  }
  write(frame);
  if (bps > 0) {
    // Hold the commit behind the frame's byte budget: the render is done, but
    // its marker is stuck behind output a slow terminal has yet to take. That
    // is the asymmetry — the tree took the socket, the marker took the pipe.
    const owed = (written / bps) * 1000 - elapsedMs();
    if (owed > 0) await sleep(owed);
  }
  // Commit, in the same shape as a real render marker: private OSC, BEL.
  write(`\x1b]7777;seq=${render};t=${committedAt.toFixed(3)}\x07`);
}

write(`\r\nFLOOD-DONE renders=${renders} bytes=${written}\r\n`);

setTimeout(() => process.exit(0), 30_000);
