const osc = (code, payload) => process.stdout.write(`\x1b]${code};${payload}\x07`);
const mark = (payload) => osc(133, payload);
let input = '';

function prompt() {
  osc(7, 'file://localhost/workspace/project');
  mark('A');
  process.stdout.write('$ ');
  mark('B');
}

osc(2, 'Termwright shell fixture');
prompt();
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  for (const char of chunk.toString('utf8')) {
    if (char === '\u0003') process.exit(0);
    if (char !== '\r' && char !== '\n') {
      input += char;
      continue;
    }
    const command = input;
    input = '';
    mark('C');
    process.stdout.write(`\r\nran ${command}\r\n`);
    if (command === 'bell') process.stdout.write('\u0007');
    mark(`D;${command === 'fail' ? 7 : 0}`);
    prompt();
  }
});
