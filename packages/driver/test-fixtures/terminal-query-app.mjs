process.stdin.setRawMode?.(true);
process.stdin.resume();

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk.toString('utf8');
  const dsr = /\x1b\[(\d+);(\d+)R/u.exec(input);
  const background = /\x1b\]11;(rgb:[0-9a-f/]+)\x1b\\/u.exec(input);
  if (dsr === null || background === null) return;
  process.stdout.write(`\r\ndsr=${dsr[1]};${dsr[2]} background=${background[1]}\r\n`);
  setTimeout(() => process.exit(0), 20);
});

process.stdout.write('\x1b[3;7H\x1b[6n\x1b]11;?\x1b\\');
