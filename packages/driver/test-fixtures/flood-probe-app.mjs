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

const start = process.hrtime.bigint();
const elapsedMs = () => Number(process.hrtime.bigint() - start) / 1e6;

let written = 0;
const write = (text) => {
  written += Buffer.byteLength(text, 'utf8');
  process.stdout.write(text);
};

for (let render = 1; render <= renders; render += 1) {
  let frame = '';
  for (let line = 0; line < lines; line += 1) {
    frame += `render ${render} line ${line} ${'.'.repeat(40)}\r\n`;
  }
  write(frame);
  // Commit, in the same shape as a real render marker: private OSC, BEL.
  write(`\x1b]7777;seq=${render};t=${elapsedMs().toFixed(3)}\x07`);
}

write(`\r\nFLOOD-DONE renders=${renders} bytes=${written}\r\n`);

setTimeout(() => process.exit(0), 30_000);
