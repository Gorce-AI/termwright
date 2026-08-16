/**
 * Escape-sequence permeability probe: writes a list of candidate sequences to
 * stdout and nothing else. The candidates are supplied by the test through
 * `TERMWRIGHT_PROBE_SPEC` (base64 JSON, each entry `{name, sequence}` with the
 * sequence as an array of char codes) so the bytes have exactly one definition
 * — the test that later looks for them.
 *
 * Each candidate is preceded by a visible sentinel line, so a candidate that
 * disappears can be told apart from a child whose output never arrived at all.
 */
const encoded = process.env['TERMWRIGHT_PROBE_SPEC'];
if (encoded === undefined) {
  process.stdout.write('PROBE-NO-SPEC\r\n');
  process.exit(2);
}

const candidates = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));

for (const [index, candidate] of candidates.entries()) {
  process.stdout.write(`SENT ${index} ${candidate.name}\r\n`);
  process.stdout.write(String.fromCharCode(...candidate.sequence));
}
process.stdout.write('\r\nPROBE-DONE\r\n');

// Stays alive so the pty is torn down by the test rather than by the child
// exiting mid-write; the timer is the backstop if the test dies first.
setTimeout(() => process.exit(0), 30_000);
