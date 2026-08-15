/**
 * Scrollback fixture: prints numbered lines so the emulator has to scroll, then
 * idles. `p` prints one more line, `q` exits.
 */
const total = Number(process.argv[2] ?? 60);
let printed = 0;

function line() {
  printed += 1;
  process.stdout.write(`line ${printed}\r\n`);
}

for (let index = 0; index < total; index += 1) line();
process.stdout.write('DONE\r\n');

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text === 'q' || text === '\x03') process.exit(0);
  if (text === 'p') line();
});
