/**
 * Environment fixture: reports whether specific variables reached the child, so
 * `envMode` can be asserted on what the child actually received rather than on
 * what the driver believes it passed.
 */
const report = (name) => {
  const value = process.env[name];
  process.stdout.write(`ENV ${name}=${value === undefined ? '<unset>' : value}\r\n`);
};

report('TERMWRIGHT_FIXTURE_SECRET');
report('TERMWRIGHT_FIXTURE_EXPLICIT');
process.stdout.write(`ENV PATH=${process.env['PATH'] === undefined ? '<unset>' : '<set>'}\r\n`);
process.stdout.write('ENV DONE\r\n');

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', () => process.exit(0));
