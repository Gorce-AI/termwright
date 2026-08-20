import { cp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../../../assets/brand/termwright-icon.svg', import.meta.url));
const target = fileURLToPath(new URL('../dist/termwright-icon.svg', import.meta.url));
await cp(source, target);

const png = await sharp(await readFile(source)).resize(1024, 1024).png().toBuffer();
await writeFile(fileURLToPath(new URL('../dist/termwright-icon.png', import.meta.url)), png);

const png2icons = createRequire(import.meta.url)('png2icons');
const icns = png2icons.createICNS(png, png2icons.BICUBIC2, 0);
const ico = png2icons.createICO(png, png2icons.BICUBIC2, 0, false, true);
if (!icns || !ico) throw new Error('could not derive desktop icons from the canonical SVG');
await writeFile(fileURLToPath(new URL('../dist/termwright-icon.icns', import.meta.url)), icns);
await writeFile(fileURLToPath(new URL('../dist/termwright-icon.ico', import.meta.url)), ico);
