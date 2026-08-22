const chunk = 'f'.repeat(8 * 1024);
for (let index = 0; index < 128; index += 1) {
  if (!process.stdout.write(`${chunk}\n`)) {
    await new Promise((resolve) => process.stdout.once('drain', resolve));
  }
}
process.stdout.write('FINAL OUTPUT SENTINEL\n');
