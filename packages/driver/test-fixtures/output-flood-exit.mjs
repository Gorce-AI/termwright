const chunk = 'f'.repeat(8 * 1024);
for (let index = 0; index < 128; index += 1) {
  if (!process.stdout.write(`${chunk}\n`)) {
    await new Promise((resolve) => process.stdout.once('drain', resolve));
  }
}
// Wait for the sentinel to leave this process before exiting. The test proves
// the driver delivers everything the child wrote; a child that exits with its
// own stdout buffer still full loses the line before the driver ever sees it,
// which on a loaded runner looked like a broken drain boundary.
await new Promise((resolve) => {
  if (process.stdout.write('FINAL OUTPUT SENTINEL\n')) resolve();
  else process.stdout.once('drain', resolve);
});
